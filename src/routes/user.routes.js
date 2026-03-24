const express = require("express")
const router = express.Router()
const authMiddleware = require("../middleware/auth.middleware")
const userController = require("../controllers/user.controller")

/**
 * GET /api/users/profile
 * Get the currently logged-in user's profile
 * Protected Route (any authenticated user)
 */
router.get("/profile", authMiddleware.authMiddleware, userController.getUserProfileController)

/**
 * GET /api/users/
 * List/search all users (with optional ?search= query)
 * Protected Route (system user only)
 */
router.get("/", authMiddleware.authSystemUserMiddleware, userController.getAllUsersController)

module.exports = router
