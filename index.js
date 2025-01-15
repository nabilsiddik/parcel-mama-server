const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

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

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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

    app.get("/", (req, res) => {
      res.send("Servicer is running perfectly");
    });

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
        timeStamp: Date.now(),
      });
      res.send(result);
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
        price = 150;
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





    // Update a specific parcel
    app.put("/parcel/:id", async (req, res) => {
      const id = req.params.id; 
      const parcel = req.body

      const query = {_id: new ObjectId(id)}
      const updatedDoc = {
        $set: parcel
      }

      const result = await parcelCollection.updateOne(query, updatedDoc)
      
      res.send(result)


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
