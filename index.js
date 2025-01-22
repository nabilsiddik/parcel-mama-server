const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const app = express();
const port = process.env.PORT || 5000;

// const cookieParser = require('cookie-parser')

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://user-authentication-30262.firebaseapp.com",
    "https://user-authentication-30262.web.app",
  ],
  credentials: true,
  optionalSuccessStatus: 200,
};

// // Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.3u9wf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();

    const userCollection = client.db("parcel-mama").collection("users");
    const parcelCollection = client.db("parcel-mama").collection("parcels");
    const reviewCollection = client.db("parcel-mama").collection("reviews");
    const paymentCollection = client.db("parcel-mama").collection("payments");

    app.get("/", (req, res) => {
      res.send("Servicer is running perfectly");
    });


    // Payment related apis
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;

        console.log('my price',price)

        if (!price || isNaN(price) || price < 0.5) {
          return res.status(400).send({
            error: "The price must be at least $0.50 and should be a valid number.",
          });
        }


        const amount = Math.round(price * 100);
        console.log('Calculated Amount (in cents):', amount);

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ['card']
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      }catch(error){
        console.error(error);
        res.status(500).send({ error: "Failed to create payment intent." })
      }
    });


    // Post payment
    app.post('/payments', async(req, res) => {
      const payment = req.body
      console.log(payment)
      const result = await paymentCollection.insertOne(payment)
      res.send(result)
    })


    // User related APIs
    // Post users
    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };

      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }

      const result = await userCollection.insertOne({
        ...user,
        role: "user",
        bookedParcel: 0,
        timeStamp: Date.now(),
      });
      res.send(result);
    });

    // Get all user
    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      const parcels = await parcelCollection.find().toArray();

      const usersWithTotalSpent = users.map((user) => {
        const userParcels = parcels.filter(
          (parcel) => parcel.customer?.email === user.email
        );

        const totalSpent = userParcels.reduce(
          (acc, parcel) => acc + parcel.price,
          0
        );

        return { ...user, totalSpent };
      });

      res.send(usersWithTotalSpent);
    });

    // Get current user
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };

      const result = await userCollection.findOne(query);

      res.send(result);
    });

    // Make normal user to admin
    app.patch("/make-admin/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: { role: "admin" },
      };

      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // Make normal user to deliveryman
    app.patch("/make-deliveryman/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: { role: "deliveryman" },
      };

      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // Delivery man related apis
    // Get all delivery mens
    app.get("/deliverymens", async (req, res) => {
      const users = await userCollection.find().toArray();

      const deliveryMens = users.filter((user) => user.role === "deliveryman");

      res.send(deliveryMens);
    });

    // get deliveryman id by email
    app.get("/deliveryManId/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };

      const deliveryMan = await userCollection.findOne(query);

      res.send(deliveryMan._id);
    });


    // get deliveryman id by using parcel id
    app.get("/deliveryman/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const parcel = await parcelCollection.findOne(query);
      const deliveryManId = parcel?.deliveryManId
      console.log(id)
      res.send(deliveryManId);
    });

    // get delivery list
    app.get("/deliverylist/:id", async (req, res) => {
      const id = req.params.id;
      const parcels = await parcelCollection.find().toArray();

      const deliveryList = parcels.filter(
        (parcel) => parcel?.deliveryManId === id
      );

      res.send(deliveryList);

      console.log(deliveryList);
    });

    // Parcel related apis
    // Post parcel
    app.post("/parcel", async (req, res) => {
      const parcel = req.body;
      const { parcelWeight } = parcel;

      let price = 50;
      if (parcelWeight === 1) {
        price = 50;
      } else if (parcelWeight === 2) {
        price = 100;
      } else {
        price = 5550;
      }

      const result = await parcelCollection.insertOne({
        ...parcel,
        price,
        status: "pending",
        apprDeliDate: "",
        bookingDate: new Date(),
        deliveryManId: "",
      });
      res.send(result);
    });

    // Increment number of booked parcel by a user
    app.patch("/increment-booked-parcel/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };

      const updatedDoc = {
        $inc: { bookedParcel: 1 },
      };

      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // get all parcels
    app.get("/parcels", async (req, res) => {
      const result = await parcelCollection.find().toArray();
      res.send(result);
    });




    // Search parcels by date range
    app.get("/search-parcels", async (req, res) => {
      const { dateFrom, dateTo } = req.query;

      try {
        const query = {};
        if (dateFrom && dateTo) {
          query.bookingDate = {
            $gte: new Date(new Date(dateFrom).setHours(0, 0, 0, 0)),
            $lte: new Date(new Date(dateTo).setHours(23, 59, 59, 999)),
          };
        } else if (dateFrom) {
          query.bookingDate = { $gte: new Date(dateFrom) };
        } else if (dateTo) {
          query.bookingDate = { $lte: new Date(dateTo) };
        }

        const result = await parcelCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({ message: "Error fetching parcels", error });
      }
    });

    // Get booked tutorial of specific user
    app.get("/my-parcels/:email", async (req, res) => {
      const email = req.params.email;

      // if(decodedEmail !== email){
      //     return res.status(401).send({message: 'unauthorize access'})
      // }

      const query = { "customer.email": email };

      const result = await parcelCollection.find(query).toArray();

      res.send(result);
    });

    // get parcel by id
    app.get("/parcel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    // update cancle parcel status
    app.patch("/cancle-parcel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: { status: "cancled" },
      };

      const result = await parcelCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // number of dlivered parcel
    app.get("/delivered-parcels", async (req, res) => {

      const parcels = await parcelCollection.find().toArray()

      const deliveredParcels = parcels.filter((parcel) => parcel.status === 'delivered')

      res.send(deliveredParcels);
    });

    // update delivered parcel status
    app.patch("/delivered-parcel/:id", async (req, res) => {
      const id = req.params.id;
      const parcelQuery = { _id: new ObjectId(id) };

      const updatedParcelDoc = {
        $set: { status: "delivered" },
      };

      const parcelResult = await parcelCollection.updateOne(parcelQuery, updatedParcelDoc);

      if (parcelResult.modifiedCount > 0) {
        const parcel = await parcelCollection.findOne(parcelQuery)
        const deliveryManId = parcel?.deliveryManId

        if (deliveryManId) {
          const deliverManQuery = { _id: new ObjectId(deliveryManId) }

          const updatedDeliveryManDoc = {
            $inc: { numOfDeliveredParcel: 1 }
          }

          const deliveryManResult = await userCollection.updateOne(deliverManQuery, updatedDeliveryManDoc)

          res.send({ parcelResult, deliveryManResult });

          console.log({ parcelResult, deliveryManResult })
        }
      }
    });


    // Find top 3 delivery man
    app.get("/top-deliverymen", async (req, res) => {
      const topDeliverymen = await userCollection
        .find({ role: "deliveryman" })
        .sort({ numOfDeliveredParcel: -1 })
        .limit(3)
        .toArray();

      res.send(topDeliverymen);

      console.log(topDeliverymen)
    });

    // Update deliveryman Id and approximate date
    app.patch("/setdeliveryman/:id", async (req, res) => {
      const id = req.params.id;
      const { deliveryMan, apprDelDate } = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          deliveryManId: deliveryMan,
          apprDeliDate: apprDelDate,
          status: "on the way",
        },
      };

      const result = await parcelCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // Update a specific parcel
    app.put("/parcel/:id", async (req, res) => {
      const id = req.params.id;
      const parcel = req.body;

      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: parcel,
      };

      const result = await parcelCollection.updateOne(query, updatedDoc);

      res.send(result);
    });







    // Review Related APIs
    // Post a review
    app.post("/reviews", async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });





  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
