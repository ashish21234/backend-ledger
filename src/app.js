const express = require("express");
const cookieParser = require("cookie-parser");
const app = express();
const authRouter = require("./routes/auth.routes")
const accountRouter = require("./routes/account.routes")
const transactionRouter = require("./routes/transaction.routes")
const userRouter = require("./routes/user.routes")


app.use(express.json())
app.use(cookieParser())

app.get("/", (req, res) => {
    res.send("Ledger Service is up and running")
})

app.use("/api/auth", authRouter)
app.use("/api/accounts", accountRouter)
app.use("/api/transactions", transactionRouter)
app.use("/api/users", userRouter)

module.exports = app; 