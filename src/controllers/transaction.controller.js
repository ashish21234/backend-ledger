const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")
const emailService = require("../services/email.service")
/**
 * -create a new transaction
 * the 10-step transfer flow:
 * 1.validate request
 * 2.validate idempotency key
 * 3.check account status
 * 4.derive sender balance from ledger
 * 5.create transaction (pending)
 * 6.create DEBIT ledger entry
 * 7.create CREDIT ledger entry
 * 8.mark transaction COMPLETED
 * 9.Commit MongoDB session
 * 10.Send email notification
 */





async function createTransaction(req, res) {

    /**
     * 1. validate request
     */
    const { fromAccount, toAccount, amount, idempotencyKey } = req.body

    if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "FromAccount, toAccount, amount and idempotencyKey are required"
        })
    }

    const fromUserAccount = await accountModel.findOne({
        _id: fromAccount
    })
    const toUserAccount = await accountModel.findOne({
        _id: toAccount
    })

    if (!fromUserAccount || !toUserAccount) {
        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        })
    }

    /**
     * 2. validate idempotencykey
     */

    const isTransactionAlreadyExists = await transactionModel.findOne({
        idempotencyKey: idempotencyKey
    })

    if (isTransactionAlreadyExists) {
        if (isTransactionAlreadyExists.status === "COMPLETED") {
            return res.status(200).json({
                message: "Transaction already completed",
                transaction: isTransactionAlreadyExists
            })
        }
        else if (isTransactionAlreadyExists.status === "PENDING") {
            return res.status(400).json({
                message: "Transaction is still processing",

            })
        }
        else if (isTransactionAlreadyExists.status === "FAILED") {
            return res.status(500).json({
                message: "Transaction failed, please retry",

            })
        }
        else if (isTransactionAlreadyExists.status === "REVERSED") {
            return res.status(400).json({
                message: "Transaction was reversed, please retry",
                transaction: isTransactionAlreadyExists
            })
        }
    }

    /**
     * 3.check account status
     */

    if (fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE") {
        return res.status(400).json({
            message: "Both fromAccount and toAccount must be active"
        })
    }

    /**
     * 4 derive sender balance
     */
    const balance = await fromUserAccount.getBalance()

    if (balance < amount) {
        return res.status(400).json({
            message: `Insufficient balance. Current balance is ${balance}. Requested amount is ${amount} `
        })
    }
    /**
     * 5. Create transaction (PENDING)
     */

    const session = await mongoose.startSession()
    session.startTransaction()

    const transaction = await transactionModel.create({
        fromAccount,
        toAccount,
        amount,
        idempotencyKey,
        status: "PENDING"
    }, {
        session
    })

    const debitLedgerEntry = await ledgerModel.create({
        account: fromAccount,
        transaction: transaction._id,
        amount: amount,
        type: "DEBIT"
    }, {
        session
    })

    const creditLedgerEntry = await ledgerModel.create({
        account: toAccount,
        transaction: transaction._id,
        amount: amount,
        type: "CREDIT"
    }, {
        session
    })

    transaction.status = "COMPLETED"
    await transaction.save({ session })

    await session.commitTransaction()
    session.endSession()

    /**
     * 10. Send email notification
     */
    await emailService.sendTransactionEmail(req.user.email, req.user.name, amount, toAccount)

    return res.status(201).json({
        message: "Transaction completed successfully",
        transaction: transaction
    })



}

module.exports = { createTransaction }