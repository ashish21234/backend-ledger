const userModel = require("../models/user.model")
const jwt = require("jsonwebtoken")
const tokenBlackListModel = require("../models/blackList.model")
async function authMiddleware(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1]
    if (!token) {
        return res.status(401).json({
            message: "Unauthorized"
        })
    }
    const isBlacklisted = await tokenBlackListModel.findOne({ token })
    if (isBlacklisted) {
        return res.status(401).json({
            message: "Unauthorized access, token is invalid"
        })
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        const user = await userModel.findById(decoded.id)
        if (!user) {
            return res.status(401).json({
                message: "Unauthorized"
            })
        }
        req.user = user
        return next()
    } catch (err) {
        return res.status(401).json({
            message: "Unauthorized"
        })
    }
}

async function authSystemUserMiddleware(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1]
    if (!token) {
        return res.status(401).json({
            message: "Unauthorized"
        })
    }
    const isBlacklisted = await tokenBlackListModel.findOne({ token })
    if (isBlacklisted) {
        return res.status(401).json({
            message: "Unauthorized access, token is invalid"
        })
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        const user = await userModel.findById(decoded.id).select("+systemUser")
        if (!user) {
            return res.status(401).json({
                message: "Unauthorized access, user not found"
            })
        }
        if (!user.systemUser) {
            return res.status(403).json({
                message: "Forbidden access, not a system user"
            })
        }
        req.user = user
        return next()
    } catch (err) {
        return res.status(401).json({
            message: "Unauthorized access, token is invalid or expired"
        })
    }
}
module.exports = { authMiddleware, authSystemUserMiddleware }