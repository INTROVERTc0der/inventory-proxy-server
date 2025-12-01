import express from 'express';
import https from 'https';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Create a custom HTTPS agent to handle self-signed certificates if needed
const httpsAgent = new https.Agent({
  rejectUnauthorized: false // Only for development, set to true in production with proper certificates
});

// Middleware to parse different content types
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.text({ 
  type: ['text/xml', 'application/soap+xml'],
  limit: '50mb' 
}));

// Health check endpoint
app.get("/", (req, res) => res.send("✅ Proxy Server Running"));

// SOAP Proxy endpoint
app.post("/api", async (req, res) => {
  try {
    const soapRequest = req.body;
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Missing Authorization header"
      });
    }

    console.log("🧾 Incoming SOAP request to proxy");

    // Forward the SOAP request to the actual SOAP endpoint
    const response = await fetch("https://br-api.silent-believers.com/soap-generic/syracuse/collaboration/syracuse/CAdxWebServiceXmlCC", {
      agent: httpsAgent,
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": req.headers['soapaction'] || '',
        "Authorization": authHeader,
        "Cookie": "client.id=daebf90c-3ce8-4fc4-b872-4434887b6a7d; syracuse.sid.8124=8ab95612-d920-43a5-be6c-9d71d6773d51",
      },
      body: soapRequest,
    });

    // Get the response text
    const responseText = await response.text();

    // Forward the SOAP response as-is
    res.set('Content-Type', 'text/xml')
       .status(response.status)
       .send(responseText);

  } catch (error) {
    console.error("🔥 Error in proxy:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start the server
const server = app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Helper function to get inventory
export function getInventoryData(distributorId, skuId = null) {
  // Mock database of inventory
  const inventory = [
    { distributor_id: 'DIST123', sku_id: 'SKU123', quantity: 100 , uom:'EA2' },
    { distributor_id: '100015', sku_id:'00342-40071-101', quantity: 34 , uom:'g'},
    { distributor_id: '100015', sku_id:'598475931', quantity: 68 , uom:'kg'},
    { distributor_id: '100015', sku_id:'11012', quantity: 68 , uom:'1 LTR'},
    { distributor_id: '100015', sku_id:'100075', quantity: 23 , uom:'piece'},
    { distributor_id: 'DIST123', sku_id: 'SKU124', quantity: 44 , uom:'packet' },
    { distributor_id: 'DIST456', sku_id: 'SKU456', quantity: 200 , uom:'carton' },
    { distributor_id: 'DIST456', sku_id: 'SKU457', quantity: 75 , uom:'box' },
    { distributor_id: 'DIST789', sku_id: 'SKU789', quantity: 30 , uom:'piece' },
  ];

  // Filter by distributor_id
  let results = inventory.filter(item => item.distributor_id === distributorId);
  
  // If sku_id is provided, filter by sku_id as well
  if (skuId) {
    results = results.filter(item => item.sku_id === skuId);
  }
  
  return results;
};

// Test endpoint - No Authentication
app.post("/test/no-auth", (req, res) => {
  const { distributor_id, sku_id } = req.body;
  console.log("No Auth Credentials:", { distributor_id, sku_id });
  if (!distributor_id) {
    return res.status(400).json({
      success: false,
      message: "distributor_id is required"
    });
  }
  
  const data = getInventoryData(distributor_id, sku_id);
  
  return res.json({
    success: true,
    message: sku_id ? "Single SKU details" : `All SKUs for distributor ${distributor_id}`,
    data: sku_id ? (data[0] || null) : data,
    count: data.length
  });
});

// Test endpoint - Basic Auth
// Basic Authentication middleware
const basicAuth = (req, res, next) => {
  console.log('🔐 Basic Auth Middleware - Processing request...');
  const authHeader = req.headers.authorization;
  console.log("🔑 Auth Header:", authHeader);
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.log("❌ Missing or invalid Basic Auth header");
    res.set('WWW-Authenticate', 'Basic realm="Authentication Required"');
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please provide valid credentials.'
    });
  }

  try {
    // Extract and decode the base64 credentials
    const base64Credentials = authHeader.split(' ')[1];
    console.log("🔑 Base64 Credentials:", base64Credentials);
    
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    console.log("🔑 Decoded Credentials:", credentials);
    
    const [username, password] = credentials.split(':');
    console.log("🔑 Extracted Credentials:", { username, password });
    
    // In a real application, you would validate against a database
    const isValidUser = username === 'arpit' && password === 'gupta';
    
    if (!isValidUser) {
      console.log("❌ Invalid username or password");
      res.set('WWW-Authenticate', 'Basic realm="Authentication Required"');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please try again.'
      });
    }
    
    // Attach user info to the request object for use in route handlers
    req.user = { username };
    console.log("✅ Authentication successful for user:", username);
    next();
  } catch (error) {
    console.error("❌ Error during authentication:", error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during authentication.'
    });
  }
};

// Protected route with Basic Authentication
app.post("/test/basic-auth", basicAuth, (req, res) => {
  console.log("Basic Auth Request:", { user: req.user.username, body: req.body });
  
  const { distributor_id, sku_id } = req.body;
  
  if (!distributor_id) {
    return res.status(400).json({
      success: false,
      message: "distributor_id is required"
    });
  }
  
  const data = getInventoryData(distributor_id, sku_id);
  
  let responseData;
  if (sku_id) {
    responseData = data[0] ? {
      distributor_id: data[0].distributor_id,
      sku_id: data[0].sku_id,
      quantity: data[0].quantity,
      uom: data[0].uom
    } : null;
  } else {
    responseData = data.map(item => ({
      distributor_id: item.distributor_id,
      sku_id: item.sku_id,
      quantity: item.quantity,
      uom: item.uom
    }));
  }

  const response = {
    success: true,
    message: `Basic Authentication successful - ${sku_id ? 'Single SKU' : 'All SKUs'}`,
    user: req.user.username, // Send back the authenticated username
    data: responseData,
    count: data.length
  };
  
  console.log("📤 Sending Basic Auth Response:", JSON.stringify(response, null, 2));
  return res.json(response);
});

// Test endpoint - Bearer Token
app.post("/test/bearer-token", (req, res) => {
  const auth = req.headers.authorization;
  const { distributor_id, sku_id } = req.body;
  
  console.log("Bearer Token Credentials:", { auth, distributor_id, sku_id });
  
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: "Bearer token required"
    });
  }
  
  if (!distributor_id) {
    return res.status(400).json({
      success: false,
      message: "distributor_id is required"
    });
  }
  
  const token = auth.split(' ')[1];
  const data = getInventoryData(distributor_id, sku_id);
  
  console.log("Bearer Token Response Data:", { distributor_id, sku_id, token, data });
  return res.json({
    success: true,
    message: `Bearer token accepted - ${sku_id ? 'Single SKU' : 'All SKUs'}`,
    token: token,
    data: sku_id ? (data[0] || null) : data,
    count: data.length
  });
});

// Test endpoint - Token Expiration and Refresh
let testToken = 'valid_token_123';
let refreshToken = 'refresh_token_456';

app.post("/test/token-expiry", (req, res) => {
  const auth = req.headers.authorization;
  const { distributor_id, sku_id } = req.body;
  
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: "Token required"
    });
  }
  
  const token = auth.split(' ')[1];
  
  if (token === 'expired_token') {
    return res.status(401).json({
      success: false,
      message: "Token expired",
      error_code: "TOKEN_EXPIRED",
      refresh_url: "http://localhost:3000/test/refresh-token"
    });
  }
  
  if (!distributor_id) {
    return res.status(400).json({
      success: false,
      message: "distributor_id is required"
    });
  }
  
  const data = getInventoryData(distributor_id, sku_id);
  
  return res.json({
    success: true,
    message: `Token is valid - ${sku_id ? 'Single SKU' : 'All SKUs'}`,
    data: sku_id ? (data[0] || null) : data,
    count: data.length
  });
});

// Token Refresh Endpoint
app.post("/test/refresh-token", (req, res) => {
  const { refresh_token } = req.body;
  
  if (refresh_token === refreshToken) {
    // In a real scenario, generate a new token and refresh token
    testToken = 'new_valid_token_' + Math.random().toString(36).substr(2, 9);
    
    return res.json({
      success: true,
      access_token: testToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: 'new_' + refreshToken
    });
  }
  
  return res.status(400).json({
    success: false,
    message: "Invalid refresh token"
  });
});

// Test endpoint - Query Parameters with Pagination
app.get("/test/query-params", (req, res) => {
  const { distributor_id, sku_id, page = 1, limit = 10 } = req.query;
  
  if (!distributor_id) {
    return res.status(400).json({
      success: false,
      message: "distributor_id is required"
    });
  }
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  
  // Get all matching items
  let data = getInventoryData(distributor_id, sku_id);
  
  // Calculate pagination
  const startIndex = (pageNum - 1) * limitNum;
  const endIndex = pageNum * limitNum;
  const paginatedData = data.slice(startIndex, endIndex);
  
  return res.json({
    success: true,
    data: {
      distributor_id,
      sku_id: sku_id || 'all',
      page: pageNum,
      limit: limitNum,
      total: data.length,
      total_pages: Math.ceil(data.length / limitNum),
      items: sku_id ? (paginatedData[0] || null) : paginatedData
    }
  });
});



app.post("/api", async (req, res) => {
  try {
    console.log("🧾 Incoming request:", {
      headers: req.headers,
      body: req.body
    });

    const { STOFCY, ITMREF, Authorization } = req.body || {};

    if (!STOFCY  || !Authorization) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: STOFCY, or Authorization",
        received: { STOFCY, ITMREF, Authorization: !!Authorization }
      });
    }

    // Prepare the payload
    const jsonPayload = {
      HEADER: { XOK: 0, XMESS: "" },
      DETAILS: [{ STOFCY, ITMREF }],
    };

    // Create SOAP request
    const soapXml = `<?xml version="1.0" encoding="UTF-8"?>
                  <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xmlns:ns2="http://www.adonix.com/WSS">
                    <soap:Header/>
                    <soap:Body>
                      <ns2:run soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                        <callContext>
                          <codeLang>FRA</codeLang>
                          <poolAlias>XWSBR</poolAlias>
                          <poolId xsi:nil="true"/>
                          <requestConfig>adxwss.optreturn=JSON</requestConfig>
                        </callContext>
                        <publicName>XGETSTOCK</publicName>
                        <inputXml><![CDATA[${JSON.stringify(jsonPayload)}]]></inputXml>
                      </ns2:run>
                    </soap:Body>
                  </soap:Envelope>`;

    console.log("🚀 Sending SOAP request...");
    const response = await fetch("https://br-api.silent-believers.com/soap-generic/syracuse/collaboration/syracuse/CAdxWebServiceXmlCC", {
      agent: httpsAgent,
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "run",
        "Authorization": Authorization,
        "Cookie": "client.id=daebf90c-3ce8-4fc4-b872-4434887b6a7d; syracuse.sid.8124=8ab95612-d920-43a5-be6c-9d71d6773d51",
      },
      body: soapXml,
    });

    // Read response once
    const responseText = await response.text();
    console.log(`🔔 Received response with status: ${response.status}`);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: `SOAP request failed with status ${response.status}`,
        response: responseText
      });
    }

    try {
      // Parse the SOAP XML
      const parser = new xml2js.Parser({ 
        explicitArray: false, 
        trim: true,
        explicitRoot: false,
        explicitCharkey: true,
        mergeAttrs: true
      });

      const result = await parser.parseStringPromise(responseText);
      console.log("📄 Parsed SOAP response:", JSON.stringify(result, null, 2));

      // Extract the result XML from the SOAP response - updated namespace handling
      const soapBody = result['soapenv:Body'] || result['soap:Body'] || result.Body;
      const runResponse = soapBody?.['wss:runResponse'] || soapBody?.runResponse;
      const runReturn = runResponse?.runReturn;
      const resultXml = runReturn?.resultXml;

      if (!resultXml) {
        console.error("❌ Could not find result XML in SOAP response. Full response:", result);
        throw new Error("Could not find result XML in SOAP response");
      }

      // The result might be in the _ property if it's a text node or directly accessible
      let jsonString;
      if (typeof resultXml === 'string') {
        jsonString = resultXml;
      } else if (resultXml._) {
        jsonString = resultXml._;
      } else if (resultXml['$']?.['xsi:type'] === 'xsd:string') {
        // Handle case where CDATA is in the attributes
        jsonString = resultXml['_'] || resultXml;
      }

      // Clean the JSON string if it's wrapped in CDATA
      if (jsonString && jsonString.includes('<![CDATA[')) {
        jsonString = jsonString.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      }

      if (!jsonString) {
        console.error("❌ No data found in result XML. Result XML:", resultXml);
        throw new Error("No data found in result XML");
      }

      // Parse the JSON from the result
      const parsedData = JSON.parse(jsonString);
      const details = parsedData?.DETAILS || [];

      return res.json({
        success: true,
        count: details.length,
        data: details,
        metadata: {
          request: { STOFCY, ITMREF },
          timestamp: new Date().toISOString()
        }
      });

    } catch (parseError) {
      console.error("❌ Error parsing response:", parseError);
      return res.status(500).json({
        success: false,
        message: "Failed to parse SOAP response",
        error: parseError.message,
        response: responseText
      });
    }

  } catch (error) {
    console.error("🔥 Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

app.get('/phprequest', async (req, res) => {
  try {
    console.log('📡 Forwarding request to PHP server...');
    
    const phpResponse = await fetch('http://localhost:3001/test.php', {
      method: 'GET',
      headers: {
        'Content-Type': 'text/html',
        'Accept': 'text/html'
      }
    });

    const data = await phpResponse.text();
    
    res.status(phpResponse.status).send(data);
  } catch (error) {
    console.error('❌ Error forwarding to PHP server:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to forward request to PHP server',
      error: error.message
    });
  }
});



// Start server
const PORT = 3030;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📡 Ready to accept requests...`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ Uncaught Exception:', error);
  process.exit(1);
});
