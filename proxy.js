import express from "express";
import fetch from "node-fetch";
import xml2js from "xml2js";
import https from 'https';

// Create a custom HTTPS agent that doesn't reject unauthorized certificates
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get("/", (req, res) => res.send("✅ Proxy Server Running"));

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
const PORT = process.env.PORT || 3030;
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