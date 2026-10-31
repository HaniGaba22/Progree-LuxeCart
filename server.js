
require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const db = require("./database");

const app = express();

const PORT = Number(process.env.PORT) || 4000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set a strong JWT_SECRET in .env");
  process.exit(1);
}

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const baseUrl =
  process.env.BASE_URL || `http://localhost:${PORT}`;

/* ==========================================
   AUTHENTICATION HELPERS
========================================== */

function getUser(req) {
  const token = req.cookies?.token;

  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"]
    });

    return db.prepare(`
      SELECT id, name, email
      FROM users
      WHERE id = ?
    `).get(payload.sub) || null;

  } catch {
    return null;
  }
}

function auth(req, res, next) {
  req.user = getUser(req);

  if (!req.user) {
    return res.status(401).json({
      error: "Please sign in first"
    });
  }

  next();
}

function setToken(res, user) {
  const token = jwt.sign({}, JWT_SECRET, {
    subject: String(user.id),
    expiresIn: "7d",
    algorithm: "HS256"
  });

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function cartFor(userId) {
  return db.prepare(`
    SELECT
      p.id AS product_id,
      p.name,
      p.category,
      p.price_cents,
      p.stock,
      p.image_url,
      c.quantity,
      p.price_cents * c.quantity AS line_total_cents
    FROM cart_items c
    JOIN products p ON p.id = c.product_id
    WHERE c.user_id = ?
    ORDER BY p.id
  `).all(userId);
}

function validateQuantity(quantity) {
  return Number.isInteger(quantity) &&
    quantity > 0 &&
    quantity <= 99;
}

/* ==========================================
   STRIPE WEBHOOK (OPTIONAL)
========================================== */

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send(
        "Stripe webhook is not configured"
      );
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      return res.status(400).send(
        `Webhook error: ${error.message}`
      );
    }

    if (
      event.type === "checkout.session.completed" &&
      event.data.object.payment_status === "paid"
    ) {
      const session = event.data.object;
      let transactionStarted = false;

      try {
        db.exec("BEGIN IMMEDIATE");
        transactionStarted = true;

        const order = db.prepare(`
          SELECT *
          FROM orders
          WHERE stripe_session_id = ?
        `).get(session.id);

        if (order && order.status === "pending") {
          const items = db.prepare(`
            SELECT *
            FROM order_items
            WHERE order_id = ?
          `).all(order.id);

          for (const item of items) {
            const result = db.prepare(`
              UPDATE products
              SET stock = stock - ?
              WHERE id = ? AND stock >= ?
            `).run(
              item.quantity,
              item.product_id,
              item.quantity
            );

            if (result.changes !== 1) {
              throw new Error(
                `Insufficient stock for product ${item.product_id}`
              );
            }
          }

          db.prepare(`
            UPDATE orders
            SET status = 'paid'
            WHERE id = ?
          `).run(order.id);

          for (const item of items) {
            db.prepare(`
              DELETE FROM cart_items
              WHERE user_id = ? AND product_id = ?
            `).run(order.user_id, item.product_id);
          }
        }

        db.exec("COMMIT");
        transactionStarted = false;

      } catch (error) {
        if (transactionStarted) {
          try {
            db.exec("ROLLBACK");
          } catch {}
        }

        console.error("Stripe webhook error:", error);

        return res.status(500).send(
          "Fulfillment failed"
        );
      }
    }

    res.json({ received: true });
  }
);

/* ==========================================
   MIDDLEWARE
========================================== */

app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie || "";

  try {
    req.cookies = Object.fromEntries(
      cookieHeader
        .split(";")
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => {
          const index = value.indexOf("=");

          return [
            value.slice(0, index),
            decodeURIComponent(value.slice(index + 1))
          ];
        })
    );
  } catch {
    req.cookies = {};
  }

  next();
});

app.use(express.static(
  path.join(__dirname, "public")
));

/* ==========================================
   SIGNUP
========================================== */

app.post("/api/signup", (req, res) => {
  const name = String(req.body?.name || "").trim();

  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  const password = req.body?.password;

  if (
    name.length < 2 ||
    name.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  ) {
    return res.status(400).json({
      error: "Enter a valid name, email and password (8–128 characters)"
    });
  }

  try {
    const passwordHash = bcrypt.hashSync(
      password,
      12
    );

    const result = db.prepare(`
      INSERT INTO users (
        name,
        email,
        password_hash
      )
      VALUES (?, ?, ?)
    `).run(name, email, passwordHash);

    const user = {
      id: Number(result.lastInsertRowid),
      name,
      email
    };

    setToken(res, user);

    res.status(201).json({ user });

  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      return res.status(409).json({
        error: "Email already registered"
      });
    }

    console.error("Signup error:", error);

    res.status(500).json({
      error: "Signup failed"
    });
  }
});

/* ==========================================
   LOGIN
========================================== */

app.post("/api/login", (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();

  const password = String(
    req.body?.password || ""
  );

  const record = db.prepare(`
    SELECT *
    FROM users
    WHERE email = ?
  `).get(email);

  if (
    !record ||
    !bcrypt.compareSync(
      password,
      record.password_hash
    )
  ) {
    return res.status(401).json({
      error: "Invalid email or password"
    });
  }

  const user = {
    id: record.id,
    name: record.name,
    email: record.email
  };

  setToken(res, user);

  res.json({ user });
});

/* ==========================================
   LOGOUT
========================================== */

app.post("/api/logout", (req, res) => {
  res.clearCookie("token", {
    path: "/"
  });

  res.json({ ok: true });
});

/* ==========================================
   CURRENT USER
========================================== */

app.get("/api/me", auth, (req, res) => {
  res.json({
    user: req.user
  });
});

/* ==========================================
   PRODUCTS
========================================== */

app.get("/api/products", (req, res) => {
  const products = db.prepare(`
    SELECT *
    FROM products
    ORDER BY id
  `).all();

  res.json(products);
});

/* ==========================================
   GET CART
========================================== */

app.get("/api/cart", auth, (req, res) => {
  res.json(cartFor(req.user.id));
});

/* ==========================================
   ADD TO CART
========================================== */

app.post("/api/cart", auth, (req, res) => {
  const productId = Number(
    req.body?.productId
  );

  const quantity = Number(
    req.body?.quantity ?? 1
  );

  if (
    !Number.isInteger(productId) ||
    !validateQuantity(quantity)
  ) {
    return res.status(400).json({
      error: "Invalid product or quantity"
    });
  }

  const product = db.prepare(`
    SELECT id, stock
    FROM products
    WHERE id = ?
  `).get(productId);

  if (!product) {
    return res.status(404).json({
      error: "Product not found"
    });
  }

  const existing = db.prepare(`
    SELECT quantity
    FROM cart_items
    WHERE user_id = ?
      AND product_id = ?
  `).get(req.user.id, productId);

  const nextQuantity =
    (existing?.quantity || 0) + quantity;

  if (
    nextQuantity > product.stock ||
    nextQuantity > 99
  ) {
    return res.status(400).json({
      error: "Not enough stock available"
    });
  }

  db.prepare(`
    INSERT INTO cart_items (
      user_id,
      product_id,
      quantity
    )
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, product_id)
    DO UPDATE SET quantity = excluded.quantity
  `).run(
    req.user.id,
    productId,
    nextQuantity
  );

  res.json(cartFor(req.user.id));
});

/* ==========================================
   UPDATE CART QUANTITY
========================================== */

app.put("/api/cart/:productId", auth, (req, res) => {
  const productId = Number(
    req.params.productId
  );

  const quantity = Number(
    req.body?.quantity
  );

  if (
    !Number.isInteger(productId) ||
    !validateQuantity(quantity)
  ) {
    return res.status(400).json({
      error: "Invalid quantity"
    });
  }

  const product = db.prepare(`
    SELECT stock
    FROM products
    WHERE id = ?
  `).get(productId);

  if (!product || quantity > product.stock) {
    return res.status(400).json({
      error: "Insufficient stock or invalid product"
    });
  }

  const result = db.prepare(`
    UPDATE cart_items
    SET quantity = ?
    WHERE user_id = ?
      AND product_id = ?
  `).run(
    quantity,
    req.user.id,
    productId
  );

  if (!result.changes) {
    return res.status(404).json({
      error: "Cart item not found"
    });
  }

  res.json(cartFor(req.user.id));
});

/* ==========================================
   REMOVE FROM CART
========================================== */

app.delete("/api/cart/:productId", auth, (req, res) => {
  db.prepare(`
    DELETE FROM cart_items
    WHERE user_id = ?
      AND product_id = ?
  `).run(
    req.user.id,
    Number(req.params.productId)
  );

  res.json(cartFor(req.user.id));
});

/* ==========================================
   ORDER HISTORY
========================================== */

app.get("/api/orders", auth, (req, res) => {
  const orders = db.prepare(`
    SELECT *
    FROM orders
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(req.user.id);

  const getItems = db.prepare(`
    SELECT
      product_id,
      name,
      unit_price_cents,
      quantity
    FROM order_items
    WHERE order_id = ?
  `);

  res.json(
    orders.map(order => ({
      ...order,
      items: getItems.all(order.id)
    }))
  );
});

/* ==========================================
   OPTIONAL STRIPE TEST CHECKOUT
========================================== */

app.post("/api/checkout", auth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: "Stripe sandbox is not configured. Use demo checkout."
    });
  }

  const cart = cartFor(req.user.id);

  if (!cart.length) {
    return res.status(400).json({
      error: "Cart is empty"
    });
  }

  if (cart.some(item => item.quantity > item.stock)) {
    return res.status(409).json({
      error: "Some items are out of stock"
    });
  }

  const total = cart.reduce(
    (sum, item) => sum + item.line_total_cents,
    0
  );

  let orderId;
  let transactionStarted = false;

  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    const order = db.prepare(`
      INSERT INTO orders (
        user_id,
        total_cents,
        status
      )
      VALUES (?, ?, 'pending')
    `).run(req.user.id, total);

    orderId = Number(order.lastInsertRowid);

    const insertItem = db.prepare(`
      INSERT INTO order_items (
        order_id,
        product_id,
        name,
        unit_price_cents,
        quantity
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of cart) {
      insertItem.run(
        orderId,
        item.product_id,
        item.name,
        item.price_cents,
        item.quantity
      );
    }

    db.exec("COMMIT");
    transactionStarted = false;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: cart.map(item => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name
          },
          unit_amount: item.price_cents
        },
        quantity: item.quantity
      })),

      success_url:
        `${baseUrl}/index.html?checkout=success`,

      cancel_url:
        `${baseUrl}/index.html?checkout=cancel`,

      client_reference_id: String(orderId),

      metadata: {
        orderId: String(orderId),
        userId: String(req.user.id)
      }
    });

    db.prepare(`
      UPDATE orders
      SET stripe_session_id = ?
      WHERE id = ?
    `).run(session.id, orderId);

    res.json({
      url: session.url
    });

  } catch (error) {
    if (transactionStarted) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }

    console.error("Stripe checkout error:", error);

    res.status(500).json({
      error: "Could not start checkout"
    });
  }
});

/* ==========================================
   DEMO CHECKOUT SUMMARY
========================================== */

app.post("/api/demo-checkout", auth, (req, res) => {
  try {
    const items = cartFor(req.user.id);

    if (!items.length) {
      return res.status(400).json({
        error: "Your shopping bag is empty."
      });
    }

    for (const item of items) {
      if (item.quantity > item.stock) {
        return res.status(409).json({
          error: `${item.name} does not have enough stock.`
        });
      }
    }

    const totalCents = items.reduce(
      (sum, item) =>
        sum + item.line_total_cents,
      0
    );

    res.json({
      items,
      total_cents: totalCents,
      mode: "demo"
    });

  } catch (error) {
    console.error("Demo checkout error:", error);

    res.status(500).json({
      error: "Unable to prepare demo checkout."
    });
  }
});

/* ==========================================
   DEMO PAYMENT SIMULATOR
   EDUCATIONAL USE ONLY
========================================== */

app.post("/api/demo-payment", auth, (req, res) => {
  const result = req.body?.result;

  if (result !== "success" && result !== "failed") {
    return res.status(400).json({
      error: "Invalid demo payment result."
    });
  }

  if (result === "failed") {
    return res.status(402).json({
      error: "Demo payment declined. No money was charged."
    });
  }

  let transactionStarted = false;

  try {
    const userId = req.user.id;

    // Begin SQLite transaction.
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    // Load the user's current cart.
    const items = cartFor(userId);

    if (!items.length) {
      throw new Error(
        "Your shopping bag is empty."
      );
    }

    // Check inventory before creating an order.
    for (const item of items) {
      if (item.quantity > item.stock) {
        throw new Error(
          `Not enough stock for ${item.name}.`
        );
      }
    }

    // Calculate total on the server.
    const totalCents = items.reduce(
      (sum, item) =>
        sum + item.price_cents * item.quantity,
      0
    );

    // Create the paid demo order.
    const orderResult = db.prepare(`
      INSERT INTO orders (
        user_id,
        total_cents,
        status
      )
      VALUES (?, ?, 'paid')
    `).run(userId, totalCents);

    const orderId = Number(
      orderResult.lastInsertRowid
    );

    // Save purchased products and reduce stock.
    for (const item of items) {
      db.prepare(`
        INSERT INTO order_items (
          order_id,
          product_id,
          name,
          unit_price_cents,
          quantity
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        orderId,
        item.product_id,
        item.name,
        item.price_cents,
        item.quantity
      );

      const stockUpdate = db.prepare(`
        UPDATE products
        SET stock = stock - ?
        WHERE id = ?
          AND stock >= ?
      `).run(
        item.quantity,
        item.product_id,
        item.quantity
      );

      if (stockUpdate.changes !== 1) {
        throw new Error(
          `Insufficient stock for ${item.name}.`
        );
      }
    }

    // Clear cart after successful demo payment.
    db.prepare(`
      DELETE FROM cart_items
      WHERE user_id = ?
    `).run(userId);

    // IMPORTANT: Commit BEFORE returning the response.
    db.exec("COMMIT");
    transactionStarted = false;

    return res.json({
      message: "Demo payment successful!",
      order: {
        order_id: orderId,
        total_cents: totalCents,
        status: "paid",
        mode: "demo"
      }
    });

  } catch (error) {
    if (transactionStarted) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Rollback failed:",
          rollbackError
        );
      }
    }

    console.error("Demo payment error:", error);

    return res.status(400).json({
      error: error.message || "Demo payment failed."
    });
  }
});

/* ==========================================
   START SERVER
========================================== */

app.listen(PORT, () => {
  console.log(
    `LuxeCart running at http://localhost:${PORT}`
  );
});
