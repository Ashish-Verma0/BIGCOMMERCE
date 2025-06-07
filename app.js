const express = require("express");
const app = express();
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cron = require("node-cron");

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/bigcommerce_orders', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'av8477@gmail.com',
        pass: process.env.EMAIL_PASS || 'ohxf vqmj mrif ulnr'
    }
});

// Order Schema
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
        paymentStatus: String
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

// Subscription Schema
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
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Function to send email with better error handling
async function sendEmail(to, subject, text) {
    try {
        const mailOptions = {
            from: process.env.EMAIL_USER || 'av8477@gmail.com',
            to: to,
            subject: subject,
            text: text
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        // Don't throw the error, just log it and continue
        return null;
    }
}

app.use(express.json());
app.use(cors({
    origin:"*",
    methods:["GET","POST","PUT","DELETE"],
    allowedHeaders:["Content-Type","Authorization"],
}));


app.get("/", (req, res) => {
    
  res.send("Hello World");
});
    
app.post("/api/add-to-cart", (req, res) => {
console.log("hello ashish",req.body)
return res.json({
    message:"hello ashish"
})
});           


const storeHash = 'j8b4yqjt7p';
const accessToken = 's1mojfx6bv3zbydkmk6ef5ukvf77d53';

// New endpoint to find product by SKU
app.get("/api/product/:sku", async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        // const storeHash = 'ty7sfwz6u1';
        // const accessToken = 'fmx6koa3tgg1vl6ycbcj0o1zr1aberc';
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
      // console.log("req.body",req.body)
        const fetch = (await import('node-fetch')).default;
        // const storeHash = 'ty7sfwz6u1';
        // const accessToken = 'fmx6koa3tgg1vl6ycbcj0o1zr1aberc';
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

        // Send subscription confirmation email
        // await sendEmail(
        //     subscription.email,
        //     'Subscription Confirmation',
        //     `Thank you for subscribing to ${subscription.productName}. Your subscription will be active for ${subscriptionDays} days.`
        // );

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

// Add retry logic function at the top of the file
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

    // Step 3: Create or get customer
    console.log("👤 Step 3: Creating/getting customer");
    
    // Use existing customer ID or create new one
    let customerId = 1; // Use the existing customer ID

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
              state_or_province: subscription.state || "California" // Use full state name for US
            }
          ],
          origin_channel_id: 1,
          channel_ids: [1]
        }
      ];

      console.log("👤 Attempting to create customer with payload:", JSON.stringify(customerPayload, null, 2));
      
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
        console.log(`ℹ️ Customer email already exists, using existing customer ID: ${customerId}`);
      } else {
        console.log(`ℹ️ Customer creation failed, using default customer ID: ${customerId}`);
      }
    }

    // Step 4: Setup shipping zone and method
    console.log("🚚 Step 4: Setting up shipping");
    
    // Get shipping zones
    const shippingZonesData = await makeApiCall(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/shipping/zones`,
      {
        method: 'GET',
        headers: {
          'X-Auth-Token': accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      },
      "Shipping zones fetch"
    );

    let shippingZoneId = 1; // Default zone ID
    if (shippingZonesData && shippingZonesData.length > 0) {
      shippingZoneId = shippingZonesData[0].id;
      console.log(`✅ Using shipping zone: ID ${shippingZoneId}`);
    }

    // Create shipping method if needed
    try {
      const shippingMethodPayload = {
        name: "Standard Shipping",
        type: "perorder",
        settings: {
          rate: 0 // Free shipping
        },
        enabled: true,
        handling_fees: {
          fixed_surcharge: "0"
        },
        channel_ids: [1]
      };

      await makeApiCall(
        `https://api.bigcommerce.com/stores/${storeHash}/v2/shipping/zones/${shippingZoneId}/methods`,
        {
          method: 'POST',
          headers: {
            'X-Auth-Token': accessToken,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(shippingMethodPayload),
        },
        "Shipping method creation"
      );
    } catch (error) {
      console.log("ℹ️ Shipping method may already exist, continuing...");
    }

    // Step 5: Create order directly using v2 Orders API
    console.log("📝 Step 5: Creating order");
    
    const orderPayload = {
      status_id: 1, // Pending status
      customer_id: customerId,
      billing_address: {
        first_name: subscription.firstName || "John",
        last_name: subscription.lastName || "Doe",
        street_1: subscription.address || "123 Test St",
        street_2: subscription.address2 || "",
        city: subscription.city || "Testville",
        state: subscription.state || "California",
        zip: subscription.zip || "12345",
        country: "United States",
        country_iso2: subscription.countryCode || "US",
        email: subscription.email || "test@example.com",
        phone: subscription.phone || "1234567890"
      },
      shipping_addresses: [
        {
          first_name: subscription.firstName || "John",
          last_name: subscription.lastName || "Doe",
          street_1: subscription.address || "123 Test St",
          street_2: subscription.address2 || "",
          city: subscription.city || "Testville",
          state: subscription.state || "California",
          zip: subscription.zip || "12345",
          country: "United States",
          country_iso2: subscription.countryCode || "US",
          email: subscription.email || "test@example.com",
          phone: subscription.phone || "1234567890"
        }
      ],
      products: [
        {
          product_id: productId,
          quantity: parseInt(subscription.quantity) || 1,
          variant_id: variantId
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
    console.log(`🎉 Order created successfully!`);
    console.log(`📋 Order ID: ${orderId}`);
    console.log(`👤 Customer ID: ${customerId}`);
    console.log(`💰 Order Total: $${orderData.total_inc_tax || orderData.subtotal_inc_tax}`);

    return {
      success: true,
      orderId: orderId,
      customerId: customerId,
      orderTotal: orderData.total_inc_tax || orderData.subtotal_inc_tax,
      message: `✅ Order ${orderId} created successfully for customer ${customerId}`,
      orderDetails: {
        id: orderId,
        status: orderData.status,
        customer_id: customerId,
        total: orderData.total_inc_tax || orderData.subtotal_inc_tax,
        created_date: orderData.date_created
      }
    };

  } catch (error) {
    console.error("❌ BigCommerce payment flow failed:", error.message);
    console.error("🔍 Error stack:", error.stack);
    
    return {
      success: false,
      error: error.message,
      message: `❌ Order creation failed: ${error.message}`,
    };
  }
}
  




// Schedule check for upcoming shipments every minute
// cron.schedule('* * * * *', async () => {
//     try {
//         console.log("hello inside cron")
//         const today = new Date();
//         const fourDaysFromNow = new Date(today);
//         fourDaysFromNow.setDate(fourDaysFromNow.getDate() + 4);

//         // Find subscriptions that are due in 4 days or have subscriptionDays <= 4
//         const subscriptions = await Subscription.find({
//             $or: [
//                 {
//                     nextShipmentDate: {
//                         $lte: fourDaysFromNow,
//                         $gt: today
//                     },
//                     status: 'active'
//                 },
//                 {
//                     subscriptionDays: { $lte: 4 },
//                     status: 'active'
//                 }
//             ]
//         });
//         console.log(`Checking ${subscriptions.length} subscriptions at ${new Date().toLocaleTimeString()}`);
//         for (const subscription of subscriptions) {
//             const daysUntilShipment = Math.ceil((subscription.nextShipmentDate - today) / (1000 * 60 * 60 * 24));
           
            
//             if (daysUntilShipment <= 4 ) {
//                 try {
//                     // Create payment in BigCommerce
//                     const paymentResult = await createBigCommercePayment(subscription);
//                     // console.log("paymentResult", paymentResult);

//                     if (paymentResult.id) {
//                         // Calculate new next shipment date by adding subscription days to current nextShipmentDate
//                         const newNextShipmentDate = new Date(subscription.nextShipmentDate);
//                         newNextShipmentDate.setDate(newNextShipmentDate.getDate() + subscription.subscriptionDays);
                        
//                         // Update the subscription
//                         const updatedSubscription = await Subscription.findByIdAndUpdate(
//                             subscription._id,
//                             {
//                                 $set: {
//                                     nextShipmentDate: newNextShipmentDate,
//                                     paymentStatus: 'completed'
//                                 }
//                             },
//                             { new: true }
//                         );
                        
//                     }
//                 } catch (error) {
//                     console.error(`Error processing subscription ${subscription._id}:`, error);
//                     await Subscription.findByIdAndUpdate(
//                         subscription._id,
//                         { $set: { paymentStatus: 'failed' } }
//                     );
//                 }
//             }
//         }
//     } catch (error) {
//         console.error('Error in subscription check:', error);
//     }
// });

app.listen(4000, () => {
  console.log("Server is running on port 4000");
});


// j8b4yqjt7p
// s1mojfx6bv3zbydkmk6ef5ukvf77d53