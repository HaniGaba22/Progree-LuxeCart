
/* ==========================================
   LUXECART - DATABASE CONNECTED FRONTEND
========================================== */

const API = "/api";

let products = [];
let cart = [];
let currentUser = null;
let selectedCategory = "All";
let cartBusy = false;

const productsGrid = document.getElementById("productsGrid");
const cartButton = document.getElementById("cartButton");
const cartDrawer = document.getElementById("cartDrawer");
const cartOverlay = document.getElementById("cartOverlay");
const closeCartButton = document.getElementById("closeCart");
const cartItems = document.getElementById("cartItems");
const cartCount = document.getElementById("cartCount");
const cartSubtotal = document.getElementById("cartSubtotal");
const checkoutButton = document.getElementById("checkoutButton");
const accountLink = document.getElementById("accountLink");

const fallbackImages = {
  1: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=700&fit=crop",
  2: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=700&fit=crop",
  3: "https://images.unsplash.com/photo-1598032895397-b9472444bf93?w=700&fit=crop",
  4: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&fit=crop",
  5: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=700&fit=crop",
  6: "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=700&fit=crop"
};

function formatPrice(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(cents || 0) / 100);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getProductImage(product) {
  return product.image_url ||
    fallbackImages[product.product_id || product.id] ||
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=700&fit=crop";
}

/* ==========================================
   API HELPER
========================================== */

async function apiRequest(endpoint, options = {}) {
  let response;

  try {
    response = await fetch(`${API}${endpoint}`, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(options.body ? {
          "Content-Type": "application/json"
        } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error("Cannot connect to the server.");
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    // Some responses may not contain JSON.
  }

  if (!response.ok) {
    const error = new Error(
      data?.error ||
      data?.message ||
      `Request failed (${response.status})`
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

/* ==========================================
   AUTHENTICATION STATUS
========================================== */

async function checkLoginStatus() {
  try {
    const data = await apiRequest("/me");

    currentUser = data.user;

    if (!currentUser) {
      return;
    }

    accountLink.textContent =
      `Hi, ${currentUser.name || "Customer"}`;

    accountLink.href = "#";

    const logoutButton = document.createElement("button");

    logoutButton.textContent = "Logout";
    logoutButton.type = "button";
    logoutButton.className = "cart-button";
    logoutButton.id = "logoutButton";

    accountLink.after(logoutButton);

    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;

      try {
        await apiRequest("/logout", {
          method: "POST"
        });

        currentUser = null;
        cart = [];
        renderCart();

        window.location.href = "/login.html";

      } catch (error) {
        alert(error.message);
        logoutButton.disabled = false;
      }
    });

  } catch (error) {
    if (error.status !== 401) {
      console.error("Authentication check failed:", error);
    }

    currentUser = null;
    accountLink.textContent = "Sign In";
    accountLink.href = "/login.html";
  }
}

/* ==========================================
   LOAD PRODUCTS FROM SQLITE
========================================== */

async function loadProducts() {
  productsGrid.innerHTML =
    "<p>Loading collection...</p>";

  try {
    const data = await apiRequest("/products");

    if (!Array.isArray(data)) {
      throw new Error("Invalid product response.");
    }

    products = data;
    renderProducts();

  } catch (error) {
    productsGrid.innerHTML =
      `<p>${escapeHTML(error.message)}</p>`;
  }
}

function renderProducts() {
  const filtered = selectedCategory === "All"
    ? products
    : products.filter(
        product => product.category === selectedCategory
      );

  if (!filtered.length) {
    productsGrid.innerHTML =
      "<p>No products found in this collection.</p>";
    return;
  }

  productsGrid.innerHTML = filtered.map(product => {
    const available = Number(product.stock) > 0;

    return `
      <article class="product-card">
        <div class="product-image">
          <img
            src="${escapeHTML(getProductImage(product))}"
            alt="${escapeHTML(product.name)}"
            loading="lazy"
          >
        </div>

        <p class="product-category">
          ${escapeHTML(product.category)}
        </p>

        <h3 class="product-name">
          ${escapeHTML(product.name)}
        </h3>

        <p class="product-description">
          ${escapeHTML(product.description)}
        </p>

        <div class="product-bottom">
          <span class="product-price">
            ${formatPrice(product.price_cents)}
          </span>

          <button
            class="add-to-cart"
            data-add-id="${Number(product.id)}"
            ${available ? "" : "disabled"}
          >
            ${available ? "ADD TO BAG +" : "SOLD OUT"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}

/* ==========================================
   DATABASE CART
========================================== */

async function loadCart() {
  if (!currentUser) {
    cart = [];
    renderCart();
    return;
  }

  try {
    const data = await apiRequest("/cart");

    if (!Array.isArray(data)) {
      throw new Error("Invalid cart response.");
    }

    cart = data;
    renderCart();

  } catch (error) {
    console.error("Unable to load cart:", error);
    cart = [];
    renderCart();
    alert(error.message);
  }
}

function renderCart() {
  const count = cart.reduce(
    (total, item) => total + Number(item.quantity),
    0
  );

  cartCount.textContent = count;

  if (!cart.length) {
    cartItems.innerHTML =
      "<p>Your shopping bag is empty.</p>";

    cartSubtotal.textContent = formatPrice(0);
    checkoutButton.disabled = true;
    return;
  }

  let subtotal = 0;

  cartItems.innerHTML = cart.map(item => {
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity);

    const lineTotal = Number(item.price_cents) * quantity;
    subtotal += lineTotal;

    return `
      <div class="cart-item">
        <img
          src="${escapeHTML(getProductImage(item))}"
          alt="${escapeHTML(item.name)}"
        >

        <div class="cart-item-info">
          <h3>${escapeHTML(item.name)}</h3>

          <p>${formatPrice(item.price_cents)}</p>

          <div class="quantity-controls">
            <button
              type="button"
              data-quantity-id="${productId}"
              data-change="-1"
              ${cartBusy ? "disabled" : ""}
            >−</button>

            <span>${quantity}</span>

            <button
              type="button"
              data-quantity-id="${productId}"
              data-change="1"
              ${cartBusy ? "disabled" : ""}
            >+</button>
          </div>

          <button
            type="button"
            class="remove-item"
            data-remove-id="${productId}"
            ${cartBusy ? "disabled" : ""}
          >
            Remove
          </button>
        </div>
      </div>
    `;
  }).join("");

  cartSubtotal.textContent = formatPrice(subtotal);
  checkoutButton.disabled = cartBusy;
}

async function addToCart(productId) {
  if (!currentUser) {
    alert("Please sign in to add products to your bag.");
    window.location.href = "/login.html";
    return;
  }

  if (cartBusy) return;

  cartBusy = true;

  try {
    const updatedCart = await apiRequest("/cart", {
      method: "POST",
      body: JSON.stringify({
        productId,
        quantity: 1
      })
    });

    if (!Array.isArray(updatedCart)) {
      throw new Error("Invalid cart response.");
    }

    cart = updatedCart;
    renderCart();
    openCart();

  } catch (error) {
    alert(error.message);

  } finally {
    cartBusy = false;
    renderCart();
  }
}

async function changeQuantity(productId, change) {
  if (cartBusy) return;

  const item = cart.find(
    entry => Number(entry.product_id) === productId
  );

  if (!item) return;

  const newQuantity = Number(item.quantity) + change;

  if (newQuantity <= 0) {
    await removeFromCart(productId);
    return;
  }

  cartBusy = true;
  renderCart();

  try {
    const updatedCart = await apiRequest(
      `/cart/${productId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          quantity: newQuantity
        })
      }
    );

    if (!Array.isArray(updatedCart)) {
      throw new Error("Invalid cart response.");
    }

    cart = updatedCart;

  } catch (error) {
    alert(error.message);

  } finally {
    cartBusy = false;
    renderCart();
  }
}

async function removeFromCart(productId) {
  if (cartBusy) return;

  cartBusy = true;
  renderCart();

  try {
    const updatedCart = await apiRequest(
      `/cart/${productId}`,
      {
        method: "DELETE"
      }
    );

    if (!Array.isArray(updatedCart)) {
      throw new Error("Invalid cart response.");
    }

    cart = updatedCart;

  } catch (error) {
    alert(error.message);

  } finally {
    cartBusy = false;
    renderCart();
  }
}

/* ==========================================
   CART DRAWER
========================================== */

function openCart() {
  cartDrawer.classList.add("open");
  cartOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  cartDrawer.classList.remove("open");
  cartOverlay.classList.remove("open");
  document.body.style.overflow = "";
}

/* ==========================================
   CHECKOUT PLACEHOLDER
========================================== */


async function proceedToCheckout() {
  if (!currentUser) {
    window.location.href = "/login.html";
    return;
  }

  if (!cart.length || cartBusy) return;

  window.location.href = "/checkout.html";

}

/* ==========================================
   BUTTON EVENTS
========================================== */

document.querySelectorAll(".filter-btn").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(btn => {
      btn.classList.remove("active");
    });

    button.classList.add("active");

    selectedCategory = button.dataset.category;
    renderProducts();
  });
});

productsGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-add-id]");

  if (button) {
    addToCart(Number(button.dataset.addId));
  }
});

cartItems.addEventListener("click", event => {
  const quantityButton = event.target.closest(
    "[data-quantity-id]"
  );

  if (quantityButton) {
    changeQuantity(
      Number(quantityButton.dataset.quantityId),
      Number(quantityButton.dataset.change)
    );
    return;
  }

  const removeButton = event.target.closest(
    "[data-remove-id]"
  );

  if (removeButton) {
    removeFromCart(Number(removeButton.dataset.removeId));
  }
});

cartButton.addEventListener("click", openCart);
closeCartButton.addEventListener("click", closeCart);
cartOverlay.addEventListener("click", closeCart);

checkoutButton.addEventListener(
  "click",
  proceedToCheckout
);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeCart();
  }
});

/* ==========================================
   START APPLICATION
========================================== */

async function initializeApp() {
  await checkLoginStatus();
  await loadProducts();
  await loadCart();
}

initializeApp();
