const express = require("express")
const router = express.Router()
const authMiddleware = require("../middleware/auth.middleware")
const accountController = require("../controllers/account.controller")
/**
 * -POST /api/accounts
 * -Create a new account
 * -Protected Route
*/
router.post("/", authMiddleware.authMiddleware, accountController.createAccountController)

/**
 * -GET /api/accounts/
 * -GET all accounts of the logged-in user
 * -Protected Route
 */
router.get("/", authMiddleware.authMiddleware, accountController.getUserAccountsController)

/**
 * -GET /api/accounts/balance/:accountId
 * -Get balance of a specific account
 * -Protected Route
 */
router.get("/balance/:accountId", authMiddleware.authMiddleware, accountController.getAccountBalanceController)

module.exports = router