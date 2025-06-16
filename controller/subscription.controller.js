const Subscription=require('../model/subscription.model')
const cron = require("node-cron");
const  sendEmail = require('../utils/sendEmail');

const storeHash = 'j8b4yqjt7p';
const accessToken = 's1mojfx6bv3zbydkmk6ef5ukvf77d53';


const addToCart=async(req,res)=>{
    console.log("hello ashish",req.body)
    return res.json({
      message:"hello ashish"
    });
}

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
      `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${subscription.productId}`,
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
      throw new Error(`❌ Product not found with SKU: ${subscription.skuId}`);
    }
console.log("product data",productData)
    const product = productData.data;
    const productId = product.id;
    console.log(`✅ Product found: ID ${productId}, Name: ${product}`);

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
    let subData=JSON.stringify(subscription, null, 2);
    let subDataParsed=JSON.parse(subData);

    
    const orderPayload = {
      status_id: 0, // Important: Must be 0 for payment processing
      customer_id: customerId,
      billing_address: {
        first_name: subDataParsed.billingAddress.firstName || orderDetails.billing_address.first_name || "John",
        last_name: subDataParsed.billingAddress.lastName || orderDetails.billing_address.last_name || "Doe",
        street_1: subDataParsed.billingAddress.street1 || orderDetails.billing_address.street_1 || "123 Test St",
        street_2: subDataParsed.billingAddress.street2 || orderDetails.billing_address.street_2 || "",
        city: subDataParsed.billingAddress.city || orderDetails.billing_address.city || "Testville",
        state: subDataParsed.billingAddress.state || orderDetails.billing_address.state || "California",
        zip: subDataParsed.billingAddress.zip || orderDetails.billing_address.zip || "12345",
        country: subDataParsed.billingAddress.country || orderDetails.billing_address.country || "United States",
        country_iso2: subDataParsed.billingAddress.countryIso2 || orderDetails.billing_address.country_iso2 || "US",
        email: subDataParsed.billingAddress.email || orderDetails.billing_address.email || "test@example.com",
        phone: subDataParsed.billingAddress.phone || orderDetails.billing_address.phone || "1234567890"
      },
      shipping_addresses: [
        {
          first_name: subDataParsed.billingAddress.firstName || orderDetails.billing_address.first_name || "John",
          last_name: subDataParsed.billingAddress.lastName || orderDetails.billing_address.last_name || "Doe",
          street_1: subDataParsed.billingAddress.street1 || orderDetails.billing_address.street_1 || "123 Test St",
          street_2: subDataParsed.billingAddress.street2 || orderDetails.billing_address.street_2 || "",
          city: subDataParsed.billingAddress.city || orderDetails.billing_address.city || "Testville",
          state: subDataParsed.billingAddress.state || orderDetails.billing_address.state || "California",
          zip: subDataParsed.billingAddress.zip || orderDetails.billing_address.zip || "12345",
          country: subDataParsed.billingAddress.country || orderDetails.billing_address.country || "United States",
          country_iso2: subDataParsed.billingAddress.countryIso2 || orderDetails.billing_address.country_iso2 || "US",
          email: subDataParsed.billingAddress.email || orderDetails.billing_address.email || "test@example.com",
          phone: subDataParsed.billingAddress.phone || orderDetails.billing_address.phone || "1234567890"
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

    // console.log("📦 Step 6: Fetching complete order details");
    // const finalOrderData = await makeApiCall(
    //   `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}`,
    //   {
    //     headers: {
    //       'X-Auth-Token': accessToken,
    //       'Content-Type': 'application/json'
    //     }
    //   },
    //   "Complete order details fetch"
    // );
    // console.log("ashishs final order data",finalOrderData)

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
            paymentMethod: paymentResult.paymentMethod || 'Manual',
            amount: orderData.total_inc_tax,
            status: 'completed',
            transactionId: paymentResult.transactionId,
            processedAt: new Date()
          }
        }
      },
      { new: true }
    );
await sendEmail({
  email: subscription.email,
  subject: "Order Confirmation",
  message: `Your order has been placed successfully. Order ID: ${orderId}`,
});
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

const productBySku=async(req,res)=>{
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
}

const storeOrderData=async(req,res)=>{
    try {
        // console.log("=== RECEIVED SESSION STORAGE DATA ===");
        // console.log("Order ID:", req.body.orderId);
        // console.log("Timestamp:", req.body.timestamp);
        // console.log("Total sessionStorage items:", req.body.sessionStorageData ? req.body.sessionStorageData.length : 0);
        
        // Log complete request body with proper JSON formatting
        // console.log("\n📦 COMPLETE REQUEST BODY:");
        // console.log(JSON.stringify(req.body, null, 2));
        
        // Log all sessionStorage data with detailed formatting
        // if (req.body.sessionStorageData && req.body.sessionStorageData.length > 0) {
        //     console.log("\n📦 DETAILED SESSION STORAGE DATA:");
        //     req.body.sessionStorageData.forEach((item, index) => {
        //         console.log(`\n=== ITEM ${index + 1} ===`);
        //         console.log(`Key: ${item.key}`);
        //         console.log(`Value Type: ${typeof item.value}`);
        //         console.log(`Value Content:`);
        //         console.log(JSON.stringify(item.value, null, 2));
                
        //         // If it's a dropdown item, extract specific fields
        //         if (item.key.startsWith('dropdown_') && item.value) {
        //             console.log(`\n🎯 DROPDOWN DETAILS:`);
        //             console.log(`  Product Name: ${item.value.productName || 'N/A'}`);
        //             console.log(`  SKU: ${item.value.sku || 'N/A'}`);
        //             console.log(`  Price: ${item.value.price || 'N/A'}`);
        //             console.log(`  Selected Option: ${JSON.stringify(item.value.selectedOption, null, 2)}`);
        //         }
        //         console.log(`==================`);
        //     });
        // }

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
        // console.log("BigCommerce Order Data:", JSON.stringify(orderData, null, 2));

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


        // Process dropdown data if exists
        const dropdownItems = req.body.sessionStorageData ? 
            req.body.sessionStorageData.filter(item => item.key.startsWith('dropdown_')) : [];
        
        if (dropdownItems.length === 0) {
            return res.json({
                success: false,
                message: "No dropdown data found in sessionStorage",
                data: { orderId: req.body.orderId }
            });
        }

        // console.log(`\n🎯 Found ${dropdownItems.length} dropdown items to process`);
        
        const createdSubscriptions = [];
        
        // Process each dropdown item
        for (let i = 0; i < dropdownItems.length; i++) {
            const dropdownItem = dropdownItems[i];
            const dropdownData = dropdownItem.value;
            
            // console.log(`\n📦 Processing Item ${i + 1}: ${dropdownItem.key}`);
            // console.log(`Product: ${dropdownData.productName}`);
            // console.log(`SKU: ${dropdownData.sku}`);
            
            if (!dropdownData.selectedOption || !dropdownData.selectedOption.label) {
                console.log(`⚠️ Skipping ${dropdownItem.key} - No selectedOption found`);
                continue;
            }
            
            const subscriptionDays = parseInt(dropdownData.selectedOption.label.match(/\d+/)?.[0]);
            
            if (!subscriptionDays) {
                console.log(`⚠️ Skipping ${dropdownItem.key} - Could not extract subscription days`);
                continue;
            }
            
            console.log(`✅ Subscription days: ${subscriptionDays}`);
            
            try {
                // Get product details
                console.log(`🔍 Fetching product details for SKU: ${dropdownData.sku}`);
                const productData = await makeApiCall(
                    `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?sku=${dropdownData.sku}`,
                    {
                        method: 'GET',
                        headers: {
                            'X-Auth-Token': accessToken,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                        }
                    },
                    `Product fetch for ${dropdownData.sku}`
                );
                
                if (!productData.data || productData.data.length === 0) {
                    console.log(`❌ Product not found with SKU: ${dropdownData.sku}`);
                    continue;
                }
                
                const product = productData.data[0];
                const productId = product.id;
                console.log(`✅ Product found: ID ${productId}, Name: ${product}`);
                
                // Get product variants
                console.log(`🔍 Fetching variants for product: ${productId}`);
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
                    `Variants fetch for product ${productId}`
                );
                
                if (!variantsData.data || variantsData.data.length === 0) {
                    console.log(`❌ No variants found for product: ${productId}`);
                    continue;
                }
                
                const variant = variantsData.data[0];
                console.log(`✅ Variant found: ID ${variant.id}, Price: ${variant}`);
                
                // Create subscription
                // console.log(`📝 Creating subscription for ${dropdownData.productName}`);
                const subscription = new Subscription({
                    orderId: req.body.orderId,
                    userId: orderData.customer_id,
                    email: orderData.billing_address.email,
                    productId: variant.product_id,
                    skuId: variant.sku_id || variant.sku,
                    quantity: 1, 
                    digital: orderData.order_is_digital || false,
                    productName: dropdownData.productName,
                    subscriptionDays: subscriptionDays,
                    startDate: new Date(),
                    nextShipmentDate: new Date(new Date().setDate(new Date().getDate() + subscriptionDays)),
                    status: 'active',
                    paymentStatus: 'pending',
                    paymentMethod: orderData?.payment_method || 'Manual',
                    billingAddress: {
                        firstName: orderData?.billing_address?.first_name,
                        lastName: orderData?.billing_address?.last_name,
                        email: orderData?.billing_address?.email,
                        phone: orderData?.billing_address?.phone,
                        street1: orderData?.billing_address?.street_1,
                        street2: orderData?.billing_address?.street_2,
                        city: orderData?.billing_address?.city,
                        state: orderData?.billing_address?.state,
                        zip: orderData?.billing_address?.zip,
                        country: orderData?.billing_address?.country,
                        countryIso2: orderData?.billing_address?.country_iso2
                    },
                    shippingAddress: {
                        firstName: orderData?.billing_address?.first_name,
                        lastName: orderData?.billing_address?.last_name,
                        email: orderData?.billing_address?.email,
                        phone: orderData?.billing_address?.phone,
                        street1: orderData?.billing_address?.street_1,
                        street2: orderData?.billing_address?.street_2,
                        city: orderData?.billing_address?.city,
                        state: orderData?.billing_address?.state,
                        zip: orderData?.billing_address?.zip,
                        country: orderData?.billing_address?.country,
                        countryIso2: orderData?.billing_address?.country_iso2
                    }
                });

                await subscription.save();
                createdSubscriptions.push(subscription);
                console.log(`✅ Subscription created successfully for ${dropdownData.productName}`);
                
            } catch (error) {
                console.error(`❌ Error processing ${dropdownItem.key}:`, error.message);
                continue;
            }
        }

        return res.json({
            success: true,
            message: `Successfully processed ${createdSubscriptions.length} subscriptions`,
            data: {
                orderId: req.body.orderId,
                totalDropdownItems: dropdownItems.length,
                createdSubscriptions: createdSubscriptions.length,
                subscriptions: createdSubscriptions.map(sub => ({
                    id: sub._id,
                    productName: sub.productName,
                    subscriptionDays: sub.subscriptionDays,
                    nextShipmentDate: sub.nextShipmentDate
                }))
            }
        });
    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({
            message: "Error processing order data",
            error: err.message
        });
    }
}

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


const verifyPayment=async(req,res)=>{
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
}

const transaction=async(req,res)=>{
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
}

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
      status: verificationResult.status,
       paymentMethod: "Online"
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

// Dashboard summary API
const getDashboardSummary = async (req, res) => {
  try {
    const totalSubscriptions = await Subscription.countDocuments();
    const totalSubscribers = await Subscription.distinct('email').then(arr => arr.length);
    const totalCustomers = await Subscription.distinct('email').then(arr => arr.length);
    const totalProducts = await Subscription.distinct('productId').then(arr => arr.length);
    const totalRatePlans = await Subscription.distinct('subscriptionDays').then(arr => arr.length);

    // Billing Operations
    const paidSubs = await Subscription.find({ paymentStatus: 'completed' });
    const paidCount = paidSubs.length;
    const paidAmount = paidSubs.reduce((sum, sub) => {
      if (Array.isArray(sub.paymentHistory)) {
        return sum + sub.paymentHistory
          .filter(p => p.status === 'completed')
          .reduce((s, p) => s + (p.amount || 0), 0);
      }
      return sum;
    }, 0);

    const processingCount = await Subscription.countDocuments({ paymentStatus: 'processing' });
    const postedCount = await Subscription.countDocuments({ paymentStatus: 'posted' });
    const refundCount = await Subscription.countDocuments({ paymentStatus: 'refund' });
    const overdueSubs = await Subscription.find({ paymentStatus: 'overdue' });
    const overdueCount = overdueSubs.length;
    const overdueAmount = overdueSubs.reduce((sum, sub) => {
      if (Array.isArray(sub.paymentHistory)) {
        return sum + sub.paymentHistory
          .filter(p => p.status === 'overdue')
          .reduce((s, p) => s + (p.amount || 0), 0);
      }
      return sum;
    }, 0);
console.log("totalCustomers",totalCustomers)
    res.json({
      subscriptions: totalSubscriptions,
      subscribers: totalSubscribers,
      customers: totalCustomers,
      products: totalProducts,
      ratePlans: totalRatePlans,
      billing: {
        paid: { count: paidCount, amount: paidAmount },
        processing: processingCount,
        posted: postedCount,
        refund: refundCount,
        overdue: { count: overdueCount, amount: overdueAmount }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// API for Subscription Dashboard Data
const getSubscriptionDashboardData = async (req, res) => {
  try {
    // Total Subscribers (unique emails)
    const totalSubscribers = await Subscription.distinct('email').then(arr => arr.length);

    // Active Plans (unique productName with active status)
    const activePlans = await Subscription.find({ status: 'active' }).distinct('productName');

    // Avg. Subscription (average of subscriptionDays in months)
    const avgSubscriptionDays = await Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, avgDays: { $avg: "$subscriptionDays" } } }
    ]);
    const avgSubscription = avgSubscriptionDays.length > 0 ? (avgSubscriptionDays[0].avgDays / 30).toFixed(1) : 0;

    // Monthly Revenue (sum of completed paymentHistory amounts in the last 30 days)
    const now = new Date();
    const lastMonth = new Date(now);
    lastMonth.setDate(now.getDate() - 30);
    const monthlyRevenueSubs = await Subscription.find({
      paymentStatus: 'completed',
      'paymentHistory.processedAt': { $gte: lastMonth }
    });
    let monthlyRevenue = 0;
    monthlyRevenueSubs.forEach(sub => {
      if (Array.isArray(sub.paymentHistory)) {
        monthlyRevenue += sub.paymentHistory
          .filter(p => p.status === 'completed' && p.processedAt >= lastMonth)
          .reduce((sum, p) => sum + (p.amount || 0), 0);
      }
    });

    // Recent Subscribers (last 4 subscriptions by startDate)
    const recentSubscribers = await Subscription.find()
      .sort({ startDate: -1 })
      .limit(4)
      .select('productName startDate status email');

    // Format for frontend
    const recent = recentSubscribers.map(sub => ({
      name: sub.email, // You can join with user collection for real name if needed
      plan: sub.productName,
      startDate: sub.startDate?.toISOString().slice(0, 10),
      status: sub.status
    }));

    res.json({
      totalSubscribers,
      activePlans: activePlans.length,
      avgSubscription,
      monthlyRevenue,
      recentSubscribers: recent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// API for Product Dashboard Data
const getProductDashboardData = async (req, res) => {
  try {
    // Get all unique products from subscriptions
    const productsRaw = await Subscription.aggregate([
      {
        $group: {
          _id: "$productId",
          name: { $first: "$productName" },
          category: { $first: { $cond: [ { $regexMatch: { input: "$productName", regex: /Add-on/i } }, "Add-on", "Subscription" ] } },
          price: { $first: "$paymentHistory.amount" }, // fallback, may need adjustment
          status: { $first: "$status" },
          sales: { $sum: 1 },
          lastUpdated: { $max: "$startDate" }
        }
      }
    ]);

    // Calculate stats
    const totalProducts = productsRaw.length;
    const activeProducts = productsRaw.filter(p => p.status === 'active').length;
    const totalSales = productsRaw.reduce((sum, p) => sum + (p.sales || 0), 0);
    // Revenue: sum of all completed paymentHistory amounts for these products
    const allSubs = await Subscription.find({});
    let revenue = 0;
    allSubs.forEach(sub => {
      if (Array.isArray(sub.paymentHistory)) {
        revenue += sub.paymentHistory
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + (p.amount || 0), 0);
      }
    });

    // Format product list for frontend
    const products = productsRaw.map((p, idx) => ({
      id: p._id || `PRD${(idx+1).toString().padStart(3, '0')}`,
      name: p.name,
      category: p.category,
      price: p.price || 0,
      status: p.status,
      sales: p.sales,
      lastUpdated: p.lastUpdated ? p.lastUpdated.toISOString().slice(0,10) : ''
    }));

    res.json({
      totalProducts,
      activeProducts,
      totalSales,
      revenue,
      products
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getAccountsDashboardData = async (req, res) => {
  try {
    // Get all subscriptions with payment history
    const subscriptions = await Subscription.find({
      'paymentHistory.0': { $exists: true }
    });

    // Calculate account statistics
    const totalBalance = subscriptions.reduce((sum, sub) => {
      const latestPayment = sub.paymentHistory[sub.paymentHistory.length - 1];
      return sum + (latestPayment?.amount || 0);
    }, 0);

    const monthlyRevenue = subscriptions.reduce((sum, sub) => {
      const thisMonth = new Date().getMonth();
      const thisYear = new Date().getFullYear();
      const monthlyPayments = sub.paymentHistory.filter(payment => {
        const paymentDate = new Date(payment.processedAt);
        return paymentDate.getMonth() === thisMonth && 
               paymentDate.getFullYear() === thisYear &&
               payment.status === 'completed';
      });
      return sum + monthlyPayments.reduce((s, p) => s + (p.amount || 0), 0);
    }, 0);

    const pendingPayments = subscriptions.reduce((sum, sub) => {
      const pendingAmount = sub.paymentHistory
        .filter(p => p.status === 'pending')
        .reduce((s, p) => s + (p.amount || 0), 0);
      return sum + pendingAmount;
    }, 0);

    const overdueAmount = subscriptions.reduce((sum, sub) => {
      const overdueAmount = sub.paymentHistory
        .filter(p => p.status === 'failed')
        .reduce((s, p) => s + (p.amount || 0), 0);
      return sum + overdueAmount;
    }, 0);

    // Get payment methods
    const paymentMethods = await Subscription.aggregate([
      { $unwind: '$paymentHistory' },
      {
        $group: {
          _id: {
            method: '$paymentHistory.paymentMethod',
            status: '$paymentHistory.status'
          },
          count: { $sum: 1 },
          total: { $sum: '$paymentHistory.amount' }
        }
      },
      {
        $group: {
          _id: '$_id.method',
          details: {
            $push: {
              status: '$_id.status',
              count: '$count',
              total: '$total'
            }
          }
        }
      }
    ]);

    // Get recent transactions
    const recentTransactions = await Subscription.aggregate([
      { $unwind: '$paymentHistory' },
      { $sort: { 'paymentHistory.processedAt': -1 } },
      { $limit: 10 },
      {
        $project: {
          id: '$paymentHistory.orderId',
          date: '$paymentHistory.processedAt',
          description: '$productName',
          amount: '$paymentHistory.amount',
          status: '$paymentHistory.status',
          type: {
            $cond: {
              if: { $eq: ['$paymentHistory.status', 'completed'] },
              then: 'credit',
              else: 'debit'
            }
          }
        }
      }
    ]);

    return res.json({
      success: true,
      data: {
        accountStats: [
          {
            title: 'Total Balance',
            value: totalBalance.toFixed(2),
            trend: 'up',
            percentage: '12.5%'
          },
          {
            title: 'Monthly Revenue',
            value: monthlyRevenue.toFixed(2),
            trend: 'up',
            percentage: '8.2%'
          },
          {
            title: 'Pending Payments',
            value: pendingPayments.toFixed(2),
            trend: 'down',
            percentage: '3.1%'
          },
          {
            title: 'Overdue Amount',
            value: overdueAmount.toFixed(2),
            trend: 'up',
            percentage: '1.2%'
          }
        ],
        paymentMethods: paymentMethods.map(method => ({
          type: method._id || 'Unknown',
          number: '****', // For security, we don't store full card numbers
          expiry: 'N/A',
          isDefault: method._id === 'Manual'
        })),
        recentTransactions
      }
    });
  } catch (error) {
    console.error('Error fetching accounts dashboard data:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports={
    verifyPayment,transaction,storeOrderData,productBySku,addToCart,
    getDashboardSummary,
    getSubscriptionDashboardData,
    getProductDashboardData,
    getAccountsDashboardData
}



