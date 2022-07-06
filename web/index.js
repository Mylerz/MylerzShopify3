// @ts-check
const { join } = require("path");
const dotenv = require('dotenv');

const fs = require("fs");
const  express  = require("express");
const  cookieParser = require("cookie-parser");
const  { Shopify, ApiVersion }  = require("@shopify/shopify-api");

const applyAuthMiddleware  = require("./middleware/auth.js");
const verifyRequest  = require("./middleware/verify-request.js");
const  setupGDPRWebHooks   = require("./gdpr.js");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// import { BillingInterval } from "./helpers/ensure-billing.js";

const USE_ONLINE_TOKENS = true;
const TOP_LEVEL_OAUTH_COOKIE = "shopify_top_level_oauth";

const PORT = parseInt(8099);
const isTest = process.env.NODE_ENV === "test" || !!process.env.VITE_TEST_BUILD;

const versionFilePath = "./version.txt";
let templateVersion = "unknown";
if (fs.existsSync(versionFilePath)) {
  templateVersion = fs.readFileSync(versionFilePath, "utf8").trim();
}

// TODO: There should be provided by env vars
const DEV_INDEX_PATH = `${process.cwd()}/dist/`;
const PROD_INDEX_PATH = `${process.cwd()}/dist/`;

const DB_PATH = `${process.cwd()}/database.sqlite`;

dotenv.config();

const {
  INTEGRATION_API,
  SHOPIFY_BRIDGE,
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,
  HOST
} = process.env;



Shopify.Context.initialize({
  API_KEY: process.env.SHOPIFY_API_KEY,
  API_SECRET_KEY: process.env.SHOPIFY_API_SECRET,
  SCOPES: process.env.SCOPES.split(","),
  HOST_NAME: process.env.HOST.replace(/https?:\/\//, ""),
  HOST_SCHEME: process.env.HOST.split("://")[0],
  API_VERSION: ApiVersion.April22,
  IS_EMBEDDED_APP: true,
  // This should be replaced with your preferred storage strategy
  SESSION_STORAGE: new Shopify.Session.SQLiteSessionStorage(DB_PATH),
  USER_AGENT_PREFIX: `Node App Template/${templateVersion}`,
});


console.log(process.env.SHOPIFY_API_KEY);
console.log(process.env.SHOPIFY_API_SECRET);
console.log(process.env.SCOPES);
console.log(process.env.HOST);
console.log(process.env.INTEGRATION_API);

// Storing the currently active shops in memory will force them to re-login when your server restarts. You should
// persist this object in your app.
const ACTIVE_SHOPIFY_SHOPS = {};
Shopify.Webhooks.Registry.addHandler("APP_UNINSTALLED", {
  path: "/api/webhooks",
  webhookHandler: async (topic, shop, body) =>
    delete ACTIVE_SHOPIFY_SHOPS[shop],
});

// The transactions with Shopify will always be marked as test transactions, unless NODE_ENV is production.
// See the ensureBilling helper to learn more about billing in this template.
const BILLING_SETTINGS = {
  required: false,
  // This is an example configuration that would do a one-time charge for $5 (only USD is currently supported)
  // chargeName: "My Shopify One-Time Charge",
  // amount: 5.0,
  // currencyCode: "USD",
  // interval: BillingInterval.OneTime,
};

// This sets up the mandatory GDPR webhooks. You’ll need to fill in the endpoint
// in the “GDPR mandatory webhooks” section in the “App setup” tab, and customize
// the code when you store customer data.
//
// More details can be found on shopify.dev:
// https://shopify.dev/apps/webhooks/configuration/mandatory-webhooks
setupGDPRWebHooks("/api/webhooks");

// export for test use only
 async function createServer(
  root = process.cwd(),
  isProd = process.env.NODE_ENV === "production",
  billingSettings = BILLING_SETTINGS
) {
  const app = express();
  app.set("top-level-oauth-cookie", TOP_LEVEL_OAUTH_COOKIE);
  app.set("active-shopify-shops", ACTIVE_SHOPIFY_SHOPS);
  app.set("use-online-tokens", USE_ONLINE_TOKENS);

  app.use(cookieParser(Shopify.Context.API_SECRET_KEY));

  applyAuthMiddleware(app, {
    billing: billingSettings,
  });

  app.post("/api/webhooks", async (req, res) => {
    try {
      await Shopify.Webhooks.Registry.process(req, res);
      console.log(`Webhook processed, returned status code 200`);
    } catch (error) {
      console.log(`Failed to process webhook: ${error}`);
      if (!res.headersSent) {
        res.status(500).send(error.message);
      }
    }
  });



  app.use(express.json());



  // All endpoints after this point will require an active session
  app.use(
    "/api/*",
    verifyRequest(app, {
      billing: billingSettings,
    })
  );

  app.get("/api/products-count", async (req, res) => {
    const session = await Shopify.Utils.loadCurrentSession(req, res, true);
    const { Product } = await import(
      `@shopify/shopify-api/dist/rest-resources/${Shopify.Context.API_VERSION}/index.js`
    );

    const countData = await Product.count({ session });
    res.status(200).send(countData);
  });

  app.post("/api/graphql", async (req, res) => {
    try {
      const response = await Shopify.Utils.graphqlProxy(req, res);
      res.status(200).send(response.body);
    } catch (error) {
      res.status(500).send(error.message);
    }
  });


  const createFulfillment = async (order, barcodeItemsTupleList, shop, accessToken) => {

    let fulfillment_orders_fetch_url = `https://${shop}/admin/api/${Shopify.Context.API_VERSION}/orders/${order.id
      }/fulfillment_orders.json?status=open`;

    let fulfillment_orders_response = await fetch(
      fulfillment_orders_fetch_url,
      {
        method: "GET",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
      }
    );
    let fulfillment_orders_result = await fulfillment_orders_response.json();

    
    // let fulfillment_result = []

    let fulfillment_result = await Promise.all(
      fulfillment_orders_result.fulfillment_orders.map(
        async (fulfillment_order, index) => {
          let checkFailedRequestObject = {};
          do {
            if (checkFailedRequestObject.errors) {
              await sleep(1000);
            }
            let line_items = fulfillment_order.line_items.map((line_item) => {
              return { id: line_item.line_item_id };
            });

            let tracking_numbers = line_items
              .filter(lineItem => barcodeItemsTupleList.find(
                (tuple) => tuple.Item1.id == lineItem.id)
              )
              .map((line_item) => {
                // console.log(`barcodeItemsTupleList: ${barcodeItemsTupleList}`);
                return barcodeItemsTupleList.find(
                  (tuple) => tuple.Item1.id == line_item.id
                ).Item2;
              });

            tracking_numbers = [...new Set(tracking_numbers)];

            let fulfillmentObject = {
              fulfillment: {
                location_id: fulfillment_order.assigned_location_id,
                tracking_numbers: tracking_numbers,
                tracking_urls: tracking_numbers.map(
                  (track) => `https://mylerz.net/trackShipment/${track}`
                ),
                tracking_company: "Mylerz",
                line_items: line_items,
              },
            };
            let fetchUrl = `https://${shop}/admin/api/${Shopify.Context.API_VERSION}/orders/${order.id}/fulfillments.json`;

            let response = await fetch(fetchUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "X-Shopify-Access-Token": accessToken,
              },
              body: JSON.stringify(fulfillmentObject),
            });
            checkFailedRequestObject = await response.json();
            console.log(checkFailedRequestObject);
          } while (checkFailedRequestObject.errors);
          return checkFailedRequestObject;
        }
      )
    );

    return fulfillment_result;
  };

  const attachPickupOrder = async (orderID, tags, pickupOrdersIDs, req, res) => {
    const session = await Shopify.Utils.loadCurrentSession(req, res);

    let url = `https://${session.shop}/admin/api/${Shopify.Context.API_VERSION}/orders/${orderID
      }.json`;

    let tagsString = tags.length > 0 ? tags + ", " + pickupOrdersIDs.join(", ") : tags + pickupOrdersIDs.join(", ");

    let requestObject = {
      order: {
        id: orderID,
        tags: tagsString
      }
    }

    console.log("tagString: " + tagsString);


    let request = await fetch(
      url,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify(requestObject),
      }
    );

    let result = await request.json();

    // console.log("attach Result : "+ JSON.stringify(result))
    return result;
  };

  const getAWB = async (barcodeList, token) => {
    try {
      console.log(`barcodeList:${barcodeList}`);
      //console.log(`token:${token}`);
      let AwbList = await Promise.all(
        barcodeList.map(async (barcode) => {
          let request = await fetch(
            `${INTEGRATION_API}/api/packages/GetAWB`,
            {
              method: "POST",
              headers: {
                Authorization: `bearer ${token}`,
                "content-type": "application/json",
              },

              body: JSON.stringify({ Barcode: barcode }),
            }
          );

          let result = await request.json();
          console.log(`AWB Result:${JSON.stringify(result)}`);
          return result;
        })
      );

      return AwbList;
    } catch (error) {
      console.log("In awb catch");
      console.log(error);
      return null;
    }
  };

  const createPickupOrder = async (barcodeList, token) => {
    try {

      let requestObject = barcodeList.map(barCode => { return { Barcode: barCode } });

      console.log(requestObject)
      let request = await fetch(
        `${INTEGRATION_API}/api/packages/CreateMultiplePickup`,
        {
          method: "POST",
          headers: {
            Authorization: `bearer ${token}`,
            "content-type": "application/json",
          },

          body: JSON.stringify(requestObject),
        }
      );

      let result = await request.json();
      console.log(result);
      return result;
    } catch (error) {
      console.log("In createPickupOrder catch");
      console.log(error);
      return null;
    }
  };

  const getNextPageUrl = (link) => {
    // if there are next page
    console.log(`Next Page URL: ${link}`);
    if (link.split(",").slice(-1)[0].split(";")[1].split("=")[1] == '"next"') {
      let url = link.split(",").slice(-1)[0].split(";")[0].trim();

      let pageInfo = `&page_info=${url.substring(1, url.length - 1).split("&page_info=")[1]}`;

      console.log(`PageInfo ${pageInfo}`)

      return pageInfo;
    } else {
      return null;
    }
  };


  app.post("/api/getZones", async (req, res) => {
    try {
      console.log(req.body.token);
      console.log(req.body.addressList);
      let request = await fetch(
        `${INTEGRATION_API}/api/orders/GetZones`,
        {
          method: "POST",
          headers: {
            Authorization: `bearer ${req.body.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(req.body.addressList),
        }
      );

      let result = await request.json();

      console.log(result);

      if (!result.IsErrorState) {
        res.send({
          status: "success",
          Zones: result.Value,
        });
      } else {
        res.send({
          status: "failed",
          Error: result.ErrorDescription,
        });
      }
    } catch (error) {
      res.send({
        status: "failed",
        Error: error,
      });
    }
  });

  app.get("/api/getCityZoneList", async (req, res) => {
    try {
      //console.log(req.body.token);
      //console.log(req.body.addressList);
      let request = await fetch(
        `${INTEGRATION_API}/api/packages/GetCityZoneList`
      );

      let result = await request.json();

      //console.log(result);

      if (!result.IsErrorState) {
        res.send({
          status: "success",
          Cities: result.Value,
        });
      } else {
        res.send({
          status: "failed",
          Error: result.ErrorDescription,
        });
      }
    } catch (error) {
      res.send({
        status: "failed",
        Error: error,
      });
    }
  });


  app.post("/api/login", async (req, res) => {
    try {
      console.log(req.body.username);
      console.log(req.body.password);

      let data = new URLSearchParams();
      data.append("username", req.body.username);
      data.append("password", req.body.password),
        data.append("grant_type", "password");

      let response = await fetch(`${INTEGRATION_API}/token`, {
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method: "POST",
        body: data,
      });

      let result = await response.json();
      console.log(result);

      if (result.error) {
        console.log("in result error");
        res.send({
          status: "failed",
          error: result.error_description,
        });
      } else {
        console.log("in success");
        res.send({
          status: "success",
          data: result,
        });
      }
    } catch (err) {
      console.log("in error");
      console.log(err);
      res.send({
        status: "failed",
        error: err,
      });
    }
  });


  app.post("/api/warehouses", async (req, res) => {
    try {
      console.log(`URL: ${INTEGRATION_API}/api/orders/GetWarehouses`);
      let request = await fetch(
        `${INTEGRATION_API}/api/orders/GetWarehouses`,
        {
          method: "GET",
          headers: {
            Authorization: `bearer ${req.body.token}`,
            "content-type": "application/json",
          },
        }
      );

      let result = await request.json();

      console.log(result);
      if (result.Message == "Authorization has been denied for this request.") {
        res.send({
          status: "failed",
          Error: result.Message,
        });
      } else if (!result.IsErrorState) {
        let warehouses = result.Value.map((warehouse) => warehouse.Name);
        res.send({
          status: "success",
          Warehouses: warehouses,
        });
      } else {
        res.send({
          status: "failed",
          Error: "result.ErrorDescription",
        });
      }
    } catch (error) {
      res.send({
        status: "failed",
        Error: `Error in Catch: ${error.stack}`,
      });
    }
  });

  app.post("/api/getAWB", async (req, res) => {
    try {
      let trackingNumbers = req.body.trackingNumbers;
      let token = req.body.token;
      // let token = req.body.token
      let AWB = await getAWB(trackingNumbers, token);

      if (AWB.every((awb) => awb.IsErrorState == false)) {
        res.send({
          status: "success",
          AWB: AWB.map((awb) => awb.Value),
          Message: "Fulfillment Completed Successfully",
        });
      } else {
        res.send({
          status: "failed",
          AWB: null,
          Message: AWB[0].ErrorDescription,
        });
      }
    } catch (error) {
      res.send({
        status: "failed",
        error: error,
      });
    }
  });

  app.post("/api/createPickupOrder", async (req, res) => {
    try {
      let barCodes = req.body.trackingNumbers;
      let token = req.body.token
      let pickupOrders = await createPickupOrder(barCodes, token);

      // if (AWB.every((awb) => awb.IsErrorState == false)) {
      res.send({
        status: "success",
        PickupOrders: pickupOrders,
        Message: "PickupOrders Created Successfully",
      });
      // } else {
      //   res.send({
      //     status: "failed",
      //     PickupOrders: null,
      //     Message: "Failed Creating PickupOrders",
      //   });
      // }
    } catch (error) {
      res.send({
        status: "failed",
        error: error,
      });
    }
  });

  app.post("/api/order/fulfill", async (req, res) => {
    try {
      let url = `${SHOPIFY_BRIDGE}/api/orders`;

      let requestBody = req.body;
      requestBody.warehouse = "";

      let orders = requestBody.orders;

      let response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      let result = await response.json();
      console.log("result---->", result);

      if (result.IsErrorState == false) {
        let trackingNumbers = result.Value.BarcodePerLineItem;

        res.send({
          status: "success",
          Barcodes: trackingNumbers,
          Message: "Fulfillment Completed Successfully",
        });
      } else {
        res.send({
          status: "failed",
          Barcodes: null,
          Message: result.ErrorDescription,
        });
      }
    } catch (err) {
      console.log("in catch server");
      console.log(err);
      res.send({
        status: "failed",
        Message: "Couldn't Complete Fulfillment",
      });
    }
  });



  app.post("/api/orders", async (req, res) => {
    try {
      const session = await Shopify.Utils.loadCurrentSession(req, res);

      let fetchUrl = req.body.url === "" ? `https://${session.shop}/admin/api/${Shopify.Context.API_VERSION}/orders.json?status=any&limit=150` : `https://${session.shop}/admin/api/${Shopify.Context.API_VERSION}/orders.json?limit=150${req.body.url}`


      // let fetchUrl = (req.body.url && req.body.url !== "") ? req.body.url : firstFetchUrl;


      console.log("fetchURL--->", fetchUrl);
      let orders = [];
      let i = 0;


      // while (fetchUrl) {

      let request = await fetch(fetchUrl, {
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
        },
      });

      let result = await request.json();

      console.log(result);
      //console.log(`iteration =  ${i}`);
      //console.log(`orders Count = ${result.orders.length}`);

      // orders.push(...result.orders)

      if (request.headers.get("link")) {
        let link = request.headers.get("link");

        // either return url or null(if there are no next page)
        fetchUrl = getNextPageUrl(link);

        console.log(`NetLink FetchURL ${fetchUrl}`)
        if (fetchUrl) i += 1;
      } else {
        fetchUrl = null;
      }
      // }

      res.send({
        status: "success",
        data: {
          orders: result.orders,
          nextLink: fetchUrl,
        },
      });
    } catch (err) {
      console.log(err);
    }
  });

  app.post("/api/order", async (req, res) => {
    try {
      const session = await Shopify.Utils.loadCurrentSession(req, res);

      let orderId = req.body.id;
      if (orderId) {
        let url = `https://${session.shop}/admin/api/${Shopify.Context.API_VERSION}/orders/${orderId}.json`;

        let request = await fetch(url, {
          headers: {
            "X-Shopify-Access-Token": session.accessToken,
          },
        });

        let result = await request.json();

        res.send({
          status: "success",
          data: {
            order: result.order,
          },
        });
      } else {
        res.send({
          status: "failed",
          Message: "No Id Sent",
        });
      }
    } catch (error) {
      res.send({
        status: "failed",
        Message: error,
      });
    }
  });
  app.post("/api/order/markAsFulfilled", async (req, res) => {
    try {
      const session = await Shopify.Utils.loadCurrentSession(req, res, true);

      let requestBody = req.body;
      let order = requestBody.order;
      let barcodes = requestBody.barcodes;

      console.log(`Barcodes: ${barcodes}`);

      let fulfillmentResult = await createFulfillment(order, barcodes, session.shop, session.accessToken);

      console.log("create Fulfillment-->", fulfillmentResult);

      if (fulfillmentResult.every((fulfillResult) => !fulfillResult.errors)) {
        res.send({
          status: "success",
          Message: "Fulfillment Completed Successfully",
        });
      } else {
        res.send({
          status: "failed",
          Message: fulfillmentResult,
        });
      }
    } catch (err) {
      console.log("in catch server");
      console.log(err);
      res.send({
        status: "failed",
        Message: "Couldn't Complete Fulfillment",
      });
    }
  });
  app.post("/api/order/attachPickupOrder", async (req, res) => {
    try {
      let requestBody = req.body;
      let orderID = requestBody.orderID;
      let tags = requestBody.tags;
      let pickupOrdersIDs = requestBody.pickupOrdersIDs;

      // console.log(`Barcodes: ${barcodes}`);

      let result = await attachPickupOrder(orderID, tags, pickupOrdersIDs, req, res);

      if (result.order) {
        res.send({
          status: "success",
          Message: "PickupOrder Attached Successfully",
        });
      } else {
        res.send({
          status: "failed",
          Message: "Error Attaching PickupOrderCodes To Order",
        });
      }
    } catch (err) {
      console.log("in catch server");
      console.log(err);
      res.send({
        status: "failed",
        Message: "Error Attaching PickupOrderCodes To Order",
      });
    }
  });


  app.use((req, res, next) => {
    const shop = req.query.shop;
    if (Shopify.Context.IS_EMBEDDED_APP && shop) {
      res.setHeader(
        "Content-Security-Policy",
        `frame-ancestors https://${shop} https://admin.shopify.com;`
      );
    } else {
      res.setHeader("Content-Security-Policy", `frame-ancestors 'none';`);
    }
    next();
  });

  app.use("/*", async (req, res, next) => {
    const shop = req.query.shop;

    // Detect whether we need to reinstall the app, any request from Shopify will
    // include a shop in the query parameters.
    if (app.get("active-shopify-shops")[shop] === undefined && shop) {
      res.redirect(`/api/auth?shop=${shop}`);
    } else {
      // res.set('X-Shopify-App-Nothing-To-See-Here', '1');
     next();
    }
  });

  if (isProd) {
    const compression = await import("compression").then(
      ({ default: fn }) => fn
    );
    const serveStatic = await import("serve-static").then(
      ({ default: fn }) => fn
    );
    app.use(compression());
    app.use(serveStatic(PROD_INDEX_PATH));
  }

  app.use("/*", async (req, res, next) => {
    const shop = req.query.shop;

    // Detect whether we need to reinstall the app, any request from Shopify will
    // include a shop in the query parameters.
    if (app.get("active-shopify-shops")[shop] === undefined && shop) {
      res.redirect(`/api/auth?shop=${shop}`);
    } else {
      // res.set('X-Shopify-App-Nothing-To-See-Here', '1');
      const fs = await import("fs");
      const fallbackFile = join(
        isProd ? PROD_INDEX_PATH : DEV_INDEX_PATH,
        "index.html"
      );
      res
        .status(200)
        .set("Content-Type", "text/html")
        .send(fs.readFileSync(fallbackFile));
    }
  });



  return { app };
}

if (!isTest) {
  console.log(process.env.PORT);
  createServer().then(({ app }) => app.listen(process.env.PORT));
}
