# Progree LuxeCart — Secure E-Commerce Engine

## Project Overview

LuxeCart is a responsive fashion e-commerce web application developed as Task 4 of the Progree Internship. It demonstrates secure user authentication, persistent shopping cart management, product inventory tracking, order history, and an educational checkout sandbox.

## Features

- User registration and login using JWT authentication
- Password hashing with bcryptjs
- Product catalog with category filtering
- Database-backed shopping cart
- Quantity management and cart subtotal
- Demo checkout with successful and failed payment scenarios
- Order creation and inventory adjustment after successful demo payment
- Order history through the My Orders page
- Responsive layout for desktop and mobile devices

## Technologies Used

- Frontend: HTML5, CSS3, JavaScript
- Backend: Node.js and Express.js
- Database: SQLite
- Authentication: JSON Web Tokens (JWT)
- Password Security: bcryptjs
- Version Control: Git and GitHub

## Installation and Setup

1. Clone the repository:

   `git clone https://github.com/HaniGaba22/Progree-LuxeCart.git`

2. Open the project folder:

   `cd Progree-LuxeCart`

3. Install dependencies:

   `npm install`

4. Create a `.env` file in the project root:

   ```env
   PORT=4000
   JWT_SECRET=replace_with_a_long_random_secret
   STRIPE_SECRET_KEY=
   STRIPE_WEBHOOK_SECRET=
   ```

5. Start the application:

   `node server.js`

6. Open in your browser:

   `http://localhost:4000`

The SQLite database and initial product catalog are initialized locally.

## Demo Checkout

The project includes an educational payment simulation. Users can test successful and failed payment scenarios without entering real payment information.

On successful simulation, an order is created, purchased product inventory is updated, and the shopping cart is cleared. Failed simulations do not create a successful order.

**Note:** Demo checkout is not a real payment transaction. Real Stripe integration requires separate sandbox configuration and testing.

## Project Structure

```text
Progree-LuxeCart/
├── public/
│   ├── index.html
│   ├── login.html
│   ├── signup.html
│   ├── checkout.html
│   ├── orders.html
│   ├── style.css
│   └── script.js
├── database.js
├── server.js
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

## Security Notes

- Passwords are stored as hashes rather than plaintext.
- Authentication uses JWT.
- Environment variables are excluded from Git.
- The SQLite database and dependency directory are not committed.

## Author

**Hania Gaba**

Bachelor of Information Technology (BIT)

Sir Syed University of Engineering & Technology

**Internship:** Progree Internship — Task 4
