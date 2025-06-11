const express=require('express')
const subscriptionRouter=express.Router()
const {verifyPayment, transaction, storeOrderData, productBySku, addToCart}=require('../controller/subscription.controller')


subscriptionRouter.get('/api/verify-payment/:orderId',verifyPayment)

subscriptionRouter.get('/api/order/:orderId/transaction',transaction)

subscriptionRouter.post('/store-order-data',storeOrderData)

subscriptionRouter.get('/api/product/:sku',productBySku)

subscriptionRouter.post('/api/add-to-cart',addToCart)


module.exports=subscriptionRouter