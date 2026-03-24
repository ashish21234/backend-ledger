const userModel = require("../models/user.model")
const accountModel = require("../models/account.model")

/**
 * GET /api/users/profile
 * Get the currently logged-in user's profile
 * Protected Route (any authenticated user)
 */
async function getUserProfileController(req, res) {
    const user = await userModel.findById(req.user._id).select("+systemUser")

    if (!user) {
        return res.status(404).json({
            message: "User not found"
        })
    }

    res.status(200).json({
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            systemUser: user.systemUser
        }
    })
}

/**
 * GET /api/users
 * List/search all users (with optional query param ?search=)
 * Protected Route (system user only)
 */
async function getAllUsersController(req, res) {
    const { search } = req.query

    let filter = {}

    if (search) {
        filter = {
            $or: [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } }
            ]
        }
    }

    const users = await userModel.find(filter).select("name email createdAt")

    // For each user, also fetch their accounts
    const usersWithAccounts = await Promise.all(
        users.map(async (user) => {
            const accounts = await accountModel.find({ user: user._id })

            const accountsWithBalance = await Promise.all(
                accounts.map(async (account) => {
                    const balance = await account.getBalance()
                    return {
                        _id: account._id,
                        status: account.status,
                        currency: account.currency,
                        balance
                    }
                })
            )

            return {
                _id: user._id,
                name: user.name,
                email: user.email,
                createdAt: user.createdAt,
                accounts: accountsWithBalance
            }
        })
    )

    res.status(200).json({
        users: usersWithAccounts
    })
}

module.exports = {
    getUserProfileController,
    getAllUsersController
}
