require('dotenv').config();
const express = require("express");
const app = express();
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cron = require("node-cron");

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bigcommerce_orders');

// Email configuration with safe defaults
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-specific-password'
    }
});

// Function to send email safely
async function sendEmailSafely(mailOptions) {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || 
            process.env.EMAIL_USER === 'your-email@gmail.com') {
            console.log("⚠️ Email credentials not configured, skipping email notification");
            return;
        }
        await transporter.sendMail(mailOptions);
        console.log("✉️ Email sent successfully");
    } catch (error) {
        console.error("📧 Failed to send email:", error.message);
    }
}

// Order Schema with enhanced payment tracking
const orderSchema = new mongoose.Schema({
    orderId: String,
    customerInfo: {
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        address: {
            street: String,
            city: String,
            state: String,
            zip: String,
            country: String
        }
    },
    orderDetails: {
        dateCreated: Date,
        status: String,
        totalAmount: Number,
        paymentMethod: String,
        paymentStatus: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
            default: 'pending'
        },
        paymentTransactionId: String,
        paymentProcessedAt: Date,
        paymentErrorMessage: String
    },
    productInfo: {
        productName: String,
        brand: String,
        price: Number,
        sku: String,
        selectedOption: {
            attributeId: Number,
            value: String,
            label: String
        }
    },
    timestamp: Date
});

const Order = mongoose.model('Order', orderSchema);

// Subscription Schema with enhanced payment tracking
const subscriptionSchema = new mongoose.Schema({
    orderId: String,
    userId: String,
    email: String,
    productId: String,
    productName: String,
    subscriptionDays: Number,
    startDate: Date,
    nextShipmentDate: Date,
    status: {
        type: String,
        enum: ['pending', 'active', 'cancelled', 'completed'],
        default: 'pending'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    paymentHistory: [{
        orderId: String,
        amount: Number,
        status: String,
        transactionId: String,
        processedAt: Date,
        errorMessage: String
    }],
    lastProcessedAt: Date,
    lastError: String,
    lastErrorDate: Date,
    retryCount: {
        type: Number,
        default: 0
    }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

app.use(express.json());
app.use(cors({
    origin:"*",
    methods:["GET","POST","PUT","DELETE"],
    allowedHeaders:["Content-Type","Authorization"],
}));

const storeHash = 'j8b4yqjt7p';
const accessToken = 's1mojfx6bv3zbydkmk6ef5ukvf77d53';

app.get("/", (req, res) => {
  res.send("Hello World");
});
    
app.post("/api/add-to-cart", (req, res) => {
  console.log("hello ashish",req.body)
  return res.json({
    message:"hello ashish"
  });
});

// Add retry logic function
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            console.log(`Retry attempt ${i + 1} for ${url}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
        }
    }
}

// Function to verify transaction status
async function verifyOrderTransaction(orderId, accessToken, storeHash) {
  try {
    const fetch = (await import('node-fetch')).default;
    console.log(`🔍 Verifying transaction for order ${orderId}`);
    
    const response = await fetch(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}/transactions`,
      {
        headers: {
          'X-Auth-Token': accessToken,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch transactions: ${response.statusText}`);
    }

    const transactions = await response.json();
    console.log(`📊 Found ${transactions.length} transactions for order ${orderId}`);
    
    // Get the latest transaction
    const latestTransaction = transactions[transactions.length - 1];
    
    return {
      success: latestTransaction?.status === "ok",
      transactionId: latestTransaction?.id,
      status: latestTransaction?.status,
      amount: latestTransaction?.amount,
      gateway: latestTransaction?.gateway,
      date: latestTransaction?.date_created
    };
  } catch (error) {
    console.error(`❌ Transaction verification failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Function to create BigCommerce payment
async function createBigCommercePayment(subscription) {
  try {
    const fetch = (await import('node-fetch')).default;
    
    console.log("🚀 Starting BigCommerce payment flow");
    console.log("📋 Subscription data:", JSON.stringify(subscription, null, 2));

    // Helper function to safely parse JSON responses
    async function safeJsonParse(response) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error("❌ Failed to parse JSON response:", text);
        throw new Error(`Invalid JSON response: ${text}`);
      }
    }

    // Helper function to make API calls with proper error handling
    async function makeApiCall(url, options, description) {
      console.log(`🔄 ${description}...`);
      console.log(`📡 URL: ${url}`);
      
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ${description} failed:`, errorText);
        throw new Error(`${description} failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await safeJsonParse(response);
      console.log(`✅ ${description} successful`);
      return data;
    }


    console.log("📦 Step 1: Fetching order details");
    const orderDetails = await makeApiCall(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${subscription.orderId}`,
      {
        method: 'GET',
        headers: {
          'X-Auth-Token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      },
      "Product fetch"
    );
console.log("ashishs order details",orderDetails)


    // Step 1: Get product details using SKU
    console.log("📦 Step 1: Fetching product details");
    const productData = await makeApiCall(
      `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?sku=${subscription.productId}`,
      {
        method: 'GET',
        headers: {
          'X-Auth-Token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      },
      "Product fetch"
    );

    if (!productData.data || productData.data.length === 0) {
      throw new Error(`❌ Product not found with SKU: ${subscription.productId}`);
    }

    const product = productData.data[0];
    const productId = product.id;
    console.log(`✅ Product found: ID ${productId}, Name: ${product.name}`);

    // Step 2: Get product variants
    console.log("🔍 Step 2: Fetching product variants");
    const variantsData = await makeApiCall(
      `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}/variants`,
      {
        method: 'GET',
        headers: {
          'X-Auth-Token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      },
      "Product variants fetch"
    );

    if (!variantsData.data || variantsData.data.length === 0) {
      throw new Error(`❌ No variants found for product: ${productId}`);
    }

    const variant = variantsData.data[0];
    const variantId = variant.id;
    console.log(`✅ Variant found: ID ${variantId}, Price: ${variant.price}`);
    console.log("variant ashishshh--------------------------------",variant)
    // Step 3: Create or get customer
    console.log("👤 Step 3: Creating/getting customer");
    
    // Use existing customer ID or create new one
    let customerId = orderDetails?.customer_id || 0;

    if (!customerId) {
      try {
        // Try to create customer only if we don't have one
        const customerPayload = [
          {
            email: subscription.email || "test@example.com",
            first_name: subscription.firstName || "John",
            last_name: subscription.lastName || "Doe",
            company: subscription.company || "",
            phone: subscription.phone || "1234567890",
            addresses: [
              {
                address1: subscription.address || "123 Test St",
                address2: subscription.address2 || "",
                address_type: "residential",
                city: subscription.city || "Testville",
                company: subscription.company || "",
                country_code: subscription.countryCode || "US",
                first_name: subscription.firstName || "John",
                last_name: subscription.lastName || "Doe",
                phone: subscription.phone || "1234567890",
                postal_code: subscription.zip || "12345",
                state_or_province: subscription.state || "California"
              }
            ],
            origin_channel_id: 1,
            channel_ids: [1]
          }
        ];

        const customerData = await makeApiCall(
          `https://api.bigcommerce.com/stores/${storeHash}/v3/customers`,
          {
            method: 'POST',
            headers: {
              'X-Auth-Token': accessToken,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(customerPayload),
          },
          "Customer creation"
        );

        customerId = customerData.data[0].id;
        console.log(`✅ New customer created: ID ${customerId}`);
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log(`ℹ️ Customer email already exists, using existing customer ID`);
        } else {
          console.error(`❌ Customer creation failed:`, error);
        }
      }
    }



    // Step 4: Create order with status_id:0 (Incomplete)
    console.log("📝 Step 4: Creating order");
    
    const orderPayload = {
      status_id: 0, // Important: Must be 0 for payment processing
      customer_id: customerId,
      billing_address: {
        first_name: orderDetails.billing_address.first_name || "John",
        last_name: orderDetails.billing_address.last_name || "Doe",
        street_1: orderDetails.billing_address.street_1 || "123 Test St",
        street_2: orderDetails.billing_address.street_2 || "",
        city: orderDetails.billing_address.city || "Testville",
        state: orderDetails.billing_address.state || "California",
        zip: orderDetails.billing_address.zip || "12345",
        country: orderDetails.billing_address.country || "United States",
        country_iso2: orderDetails.billing_address.country_iso2 || "US",
        email: orderDetails.billing_address.email || "test@example.com",
        phone: orderDetails.billing_address.phone || "1234567890"
      },
      shipping_addresses: [
        {
          first_name: orderDetails.billing_address.first_name || "John",
          last_name: orderDetails.billing_address.last_name || "Doe",
          street_1: orderDetails.billing_address.street_1 || "123 Test St",
          street_2: orderDetails.billing_address.street_2 || "",
          city: orderDetails.billing_address.city || "Testville",
          state: orderDetails.billing_address.state || "California",
          zip: orderDetails.billing_address.zip || "12345",
          country: orderDetails.billing_address.country || "United States",
          country_iso2: orderDetails.billing_address.country_iso2 || "US",
          email: orderDetails.billing_address.email || "test@example.com",
          phone: orderDetails.billing_address.phone || "1234567890"
        }
      ],
      products: [
        {
          product_id: productId,
          quantity: parseInt(subscription.quantity) || 1,
          variant_id: variantId,
          price_inc_tax: variant.calculated_price || variant.price || product.price,
          price_ex_tax: variant.calculated_price || variant.price || product.price
        }
      ],
      channel_id: 1
    };

    console.log("📋 Order payload:", JSON.stringify(orderPayload, null, 2));

    const orderData = await makeApiCall(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders`,
      {
        method: 'POST',
        headers: {
          'X-Auth-Token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(orderPayload),
      },
      "Order creation"
    );

    const orderId = orderData.id;
    console.log(`🎉 Order created successfully! Order ID: ${orderId}`);

    // Step 5: Process payment
    console.log("💳 Step 5: Processing payment");
    const paymentResult = await processBigCommercePayment(orderId);

    if (!paymentResult.success) {
      throw new Error(`Payment failed: ${paymentResult.error}`);
    }

    // Update subscription with successful payment
    const newNextShipmentDate = new Date(subscription.nextShipmentDate);
    newNextShipmentDate.setDate(newNextShipmentDate.getDate() + subscription.subscriptionDays);
    
    const updatedSubscription = await Subscription.findByIdAndUpdate(
      subscription._id,
      {
        $set: {
          nextShipmentDate: newNextShipmentDate,
          paymentStatus: 'completed',
          lastProcessedAt: new Date(),
          lastError: null,
          lastErrorDate: null,
          retryCount: 0
        },
        $push: {
          paymentHistory: {
            orderId: orderId,
            amount: orderData.total_inc_tax,
            status: 'completed',
            transactionId: paymentResult.transactionId,
            processedAt: new Date()
          }
        }
      },
      { new: true }
    );

    return {
      success: true,
      orderId: orderId,
      customerId: customerId,
      orderTotal: orderData.total_inc_tax,
      transactionId: paymentResult.transactionId,
      transactionStatus: paymentResult.status,
      message: `✅ Order ${orderId} created and payment processed successfully`,
      orderDetails: {
        id: orderId,
        status: "Awaiting Fulfillment",
        payment_status: "captured",
        customer_id: customerId,
        total: orderData.total_inc_tax,
        created_date: orderData.date_created
      }
    };

  } catch (error) {
    console.error("❌ BigCommerce payment flow failed:", error.message);
    console.error("🔍 Error stack:", error.stack);
    
    // Update subscription with error details
    if (subscription._id) {
      await Subscription.findByIdAndUpdate(
        subscription._id,
        {
          $set: {
            paymentStatus: 'failed',
            lastError: error.message,
            lastErrorDate: new Date(),
            retryCount: (subscription.retryCount || 0) + 1
          }
        }
      );
    }
    
    return {
      success: false,
      error: error.message,
      message: `❌ Payment processing failed: ${error.message}`,
    };
  }
}

// New endpoint to find product by SKU
app.get("/api/product/:sku", async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const sku = req.params.sku;
        
        // BigCommerce API endpoint for products with SKU filter
        const url = `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?sku=${sku}`;
        
        const options = {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Auth-Token': accessToken
            }
        };

        const response = await fetch(url, options);
        const productData = await response.json();

        if (!productData.data || productData.data.length === 0) {
            return res.status(404).json({
                message: "Product not found",
                sku: sku
            });
        }

        return res.json({
            message: "Product found successfully",
            data: productData.data[0]
        });
    } catch (err) {
        console.error("❌ Error fetching product:", err);
        return res.status(500).json({
            message: "Error fetching product data",
            error: err.message
        });
    }
});

app.post("/store-order-data", async(req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${req.body.orderId}`;
        
        const options = {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Auth-Token': accessToken
            }
        };

        const response = await fetch(url, options);
        const orderData = await response.json();
        console.log("orderData",orderData)
        // Extract subscription days from selectedOption
        const subscriptionDays = parseInt(req.body?.dropdownData?.selectedOption?.label?.match(/\d+/)[0]);
        // Create subscription
        const subscription = new Subscription({
            orderId: req.body.orderId,
            userId: orderData.customer_id,
            email: orderData.billing_address.email,
            productId: req.body.dropdownData.sku,
            productName: req.body.dropdownData.productName,
            subscriptionDays: subscriptionDays,
            startDate: new Date(),
            nextShipmentDate: new Date(new Date().setDate(new Date().getDate() + subscriptionDays)),
            status: 'pending',
            paymentStatus: 'pending'
        });

        await subscription.save();

        return res.json({
            message: "Order and subscription data stored successfully",
            data: {
                order: orderData,
                subscription: subscription
            }
        });
    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({
            message: "Error processing order data",
            error: err.message
        });
    }
});

// Schedule check for upcoming shipments every minute
cron.schedule('* * * * *', async () => {
    try {
        console.log("hello inside cron")
        const today = new Date();
        const fourDaysFromNow = new Date(today);
        fourDaysFromNow.setDate(fourDaysFromNow.getDate() + 4);

        // Find subscriptions that are due in 4 days or have subscriptionDays <= 4
        const subscriptions = await Subscription.find({
            $or: [
                {
                    nextShipmentDate: {
                        $lte: fourDaysFromNow,
                        $gt: today
                    },
                    status: 'active'
                },
                // {
                //     subscriptionDays: { $lte: 4 },
                //     status: 'active'
                // }
            ]
        });
        console.log(`Checking ${subscriptions.length} subscriptions at ${new Date().toLocaleTimeString()}`);

        for (const subscription of subscriptions) {
          console.log("ashish subscription days",subscription)

            const daysUntilShipment = Math.ceil((subscription.nextShipmentDate - today) / (1000 * 60 * 60 * 24));
            if (daysUntilShipment <= 4 ) {
                try {
                    // Create payment in BigCommerce
                    const paymentResult = await createBigCommercePayment(subscription);

                    if (paymentResult.id) {
                        // Calculate new next shipment date by adding subscription days to current nextShipmentDate
                        const newNextShipmentDate = new Date(subscription.nextShipmentDate);
                        newNextShipmentDate.setDate(newNextShipmentDate.getDate() + subscription.subscriptionDays);
                        
                        // Update the subscription
                        const updatedSubscription = await Subscription.findByIdAndUpdate(
                            subscription._id,
                            {
                                $set: {
                                    nextShipmentDate: newNextShipmentDate,
                                    paymentStatus: 'completed'
                                }
                            },
                            { new: true }
                        );
                    }
                } catch (error) {
                    console.error(`Error processing subscription ${subscription._id}:`, error);
                    await Subscription.findByIdAndUpdate(
                        subscription._id,
                        { $set: { paymentStatus: 'failed' } }
                    );
                }
            }
        }
    } catch (error) {
        console.error('Error in subscription check:', error);
    }
});

// New endpoint to verify payment status
app.get("/api/verify-payment/:orderId", async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const orderId = req.params.orderId;
    
    // Get order transactions
    const response = await fetch(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}/transactions`,
      {
        headers: {
          'X-Auth-Token': accessToken,
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch payment status: ${response.statusText}`);
    }
    
    const transactions = await response.json();
    
    // Find the most recent transaction
    const latestTransaction = transactions[transactions.length - 1];
    
    return res.json({
      success: true,
      orderId: orderId,
      paymentStatus: latestTransaction?.status || 'unknown',
      transactionId: latestTransaction?.id,
      amount: latestTransaction?.amount,
      processedAt: latestTransaction?.date_created,
      gateway: latestTransaction?.gateway
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add new endpoint to check transaction status
app.get("/api/order/:orderId/transaction", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const transactionStatus = await verifyOrderTransaction(orderId, accessToken, storeHash);
    
    return res.json({
      success: true,
      orderId: orderId,
      transaction: transactionStatus
    });
  } catch (error) {
    console.error("Transaction check error:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Function to process BigCommerce payment
async function processBigCommercePayment(orderId) {
  try {
    const fetch = (await import('node-fetch')).default;
    console.log(`🔄 Processing payment for order ${orderId}`);

    // Step 1: Check payment methods
    console.log("Step 1: Getting payment methods");
    const methodsResponse = await fetch(
      `https://api.bigcommerce.com/stores/${storeHash}/v3/payments/methods?order_id=${orderId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': accessToken
        }
      }
    );

    if (!methodsResponse.ok) {
      const error = await methodsResponse.text();
      console.warn(`⚠️ Failed to get payment methods: ${error}`);
      console.log("↪️ Falling back to COD payment method");
      return await processAsCashOnDelivery(orderId);
    }

    const methodsData = await methodsResponse.json();
    console.log("Available payment methods:", JSON.stringify(methodsData.data, null, 2));

    // Check if online payments are available and properly configured
    const braintreeMethod = methodsData.data?.find(method => method.id === 'braintree.card');
    const isOnlinePaymentEnabled = methodsData.data && methodsData.data.length > 0;
    const isBraintreeConfigured = braintreeMethod && braintreeMethod.test_mode;

    if (!isOnlinePaymentEnabled || !isBraintreeConfigured) {
      console.log("⚠️ Online payment methods are disabled or not properly configured");
      console.log("↪️ Falling back to COD payment method");
      return await processAsCashOnDelivery(orderId);
    }

    // If we get here, proceed with online payment processing
    console.log("✅ Online payment methods are available and configured");
    
    // Step 2: Create Payment Access Token
    console.log("Step 2: Creating payment access token");
    const tokenResponse = await fetch(
      `https://api.bigcommerce.com/stores/${storeHash}/v3/payments/access_tokens`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': accessToken
        },
        body: JSON.stringify({
          order: {
            id: orderId
          }
        })
      }
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Failed to create payment token: ${error}`);
    }

    const tokenData = await tokenResponse.json();
    const paymentToken = tokenData.data.id;
    console.log("✅ Payment token created");

    // Step 3: Process the Payment
    console.log("Step 3: Processing payment");
    
    // Check if test mode is enabled
    const isTestMode = braintreeMethod.test_mode;
    console.log(`🔄 Payment mode: ${isTestMode ? 'TEST' : 'PRODUCTION'}`);
    
    // Configure payment details based on mode
    const paymentDetails = {
      instrument: {
        type: "card",
        number: isTestMode ? "4111111111111111" : null, // Test card for Visa
        cardholder_name: "John Doe",
        expiry_month: 12,
        expiry_year: 2025,
        verification_value: "123"
      },
      payment_method_id: "braintree.card",
      save_instrument: false
    };

    // Add additional test mode validation
    if (!isTestMode) {
      throw new Error(
        "Test mode is not enabled in Braintree settings. Please follow these steps:\n" +
        "1. Go to your BigCommerce admin panel\n" +
        "2. Navigate to Settings > Setup > Payments\n" +
        "3. Click on the Braintree tab\n" +
        "4. Enable Test Mode\n" +
        "5. Save settings"
      );
    }

    console.log("💳 Processing payment with details:", JSON.stringify(paymentDetails, null, 2));

    const paymentResponse = await fetch(
      `https://payments.bigcommerce.com/stores/${storeHash}/payments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.bc.v1+json',
          'Authorization': `PAT ${paymentToken}`
        },
        body: JSON.stringify({ payment: paymentDetails })
      }
    );

    if (!paymentResponse.ok) {
      const error = await paymentResponse.text();
      console.error("❌ Payment API error response:", error);
      throw new Error(`Payment processing failed: ${error}`);
    }

    const paymentResult = await paymentResponse.json();
    console.log("✅ Payment processed successfully:", JSON.stringify(paymentResult, null, 2));

    // Update order status after successful payment
    console.log("📝 Updating order status...");
    const orderUpdateResponse = await fetch(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': accessToken
        },
        body: JSON.stringify({
          status_id: 11, // Awaiting Fulfillment
          payment_status: "captured"
        })
      }
    );

    if (!orderUpdateResponse.ok) {
      console.warn("⚠️ Failed to update order status, but payment was successful");
    } else {
      console.log("✅ Order status updated successfully");
    }

    // Step 4: Verify the transaction
    const verificationResult = await verifyOrderTransaction(orderId, accessToken, storeHash);
    if (!verificationResult.success) {
      throw new Error(`Payment verification failed: ${verificationResult.error || 'Unknown error'}`);
    }

    return {
      success: true,
      transactionId: verificationResult.transactionId,
      status: verificationResult.status
    };

  } catch (error) {
    console.error("❌ Payment processing failed:", error);
    console.log("↪️ Attempting to fall back to COD payment method");
    try {
      return await processAsCashOnDelivery(orderId);
    } catch (codError) {
      console.error("❌ COD fallback also failed:", codError);
      return {
        success: false,
        error: `Payment processing failed and COD fallback failed: ${codError.message}`
      };
    }
  }
}

// New function to handle Cash on Delivery
async function processAsCashOnDelivery(orderId) {
  try {
    const fetch = (await import('node-fetch')).default;
    console.log(`🔄 Processing order ${orderId} as Cash on Delivery`);

    // Update order status for COD
    const orderUpdateResponse = await fetch(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': accessToken
        },
        body: JSON.stringify({
          status_id: 11, // Awaiting Fulfillment
          payment_method: "Cash on Delivery",
          payment_provider_id: null
        })
      }
    );

    if (!orderUpdateResponse.ok) {
      throw new Error(`Failed to update order as COD: ${await orderUpdateResponse.text()}`);
    }

    console.log("✅ Order successfully updated to Cash on Delivery");
    
    return {
      success: true,
      status: "pending",
      message: "Order processed as Cash on Delivery",
      paymentMethod: "Cash on Delivery"
    };

  } catch (error) {
    console.error("❌ Failed to process as COD:", error);
    throw error;
  }
}

app.listen(4000, () => {
  console.log("Server is running on port 4000");
}); 