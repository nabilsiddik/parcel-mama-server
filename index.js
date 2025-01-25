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
    "https://my-project-22db9.firebaseapp.com",
    "https://my-project-22db9.web.app",
  ],
  credentials: true,
  optionalSuccessStatus: 200,
};

// // Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));


// Verify token

const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'Forbidden access' })
  }

  const token = req.headers.authorization.split(' ')[1]

  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Forbidden access' })
    }
    req.decoded = decoded
    next()
  })
}



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



    // use verify admin after verify token
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email
      const query = { email: email }
      const user = await userCollection.findOne(query)

      const isAdmin = user?.role === 'admin'

      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' })
      }

      next()

    }


    // Jwt related apis
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.SECRET_KEY, {
        expiresIn: '1h'
      })

      res.send({ token })
    })

    // Payment related apis
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;

        if (!price || isNaN(price) || price < 0.5) {
          return res.status(400).send({
            error: "The price must be at least $0.50 and should be a valid number.",
          });
        }


        const amount = Math.round(price * 100);

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ['card']
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to create payment intent." })
      }
    });


    // Post payment
    app.post('/payments', async (req, res) => {
      const payment = req.body
      const result = await paymentCollection.insertOne(payment)
      res.send(result)
    })


    // User related APIs
    // Post users
    app.post("/users/:email",
      async (req, res) => {
        const email = req.params.email;
        const user = req.body;
        const { role, phone } = req.body
        const query = { email };

        const isExist = await userCollection.findOne(query);
        if (isExist) {
          return res.send(isExist);
        }

        const result = await userCollection.insertOne({
          ...user,
          role: role ? role : 'user',
          phone: phone ? phone : 8801,
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

    // update delivery man rating
    app.patch("/update-deliverman-rating/:id", async (req, res) => {
      const id = req.params.id;
      const { rating } = req.body

      const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) })

      const deliveryManId = parcel?.deliveryManId

      if (!deliveryManId) {
        return res.status(404).send({ message: "Delivery man not found for this parcel" });
      }

      const deliveryMan = await userCollection.findOne({ _id: new ObjectId(deliveryManId) });
      const currentRating = deliveryMan?.rating || 0
      const reviewCount = deliveryMan?.reviewCount || 0

      const newReviewCount = reviewCount + 1
      const newAverageRating = ((currentRating * reviewCount) + rating) / newReviewCount

      const deliveryManQuery = { _id: new ObjectId(deliveryManId) }

      const updatedDoc = {
        $set: {
          avarageRating: newAverageRating,
          reviewCount: newReviewCount
        }
      };

      const result = await userCollection.updateOne(deliveryManQuery, updatedDoc);
      res.send(result);
    });


    // get admin
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'unauthorized access' })
      }

      const query = { email };

      const user = await userCollection.findOne(query);
      let admin = false
      if (user) {
        admin = user?.role === 'admin'
      }
      res.send({ admin });
    });


    // Make normal user to admin
    app.patch("/make-admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: { role: "admin" },
      };

      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // Make normal user to deliveryman
    app.patch("/make-deliveryman/:id", verifyToken, verifyAdmin, async (req, res) => {
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


    // Sort parcel by status
    app.get("/sort-parcel", async (req, res) => {
      const { status } = req.query;

      try {
        // Sort by the `status` field in ascending or descending order
        const parcels = await parcelCollection
          .find()
          .sort({ status: status === "delivered" ? 1 : -1 }) // Correct sorting logic
          .toArray();

        console.log("Sorting by status:", status);
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching sorted parcels:", error);
        res.status(500).send({ message: "Failed to fetch sorted parcels." });
      }
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

        }
      }
    });


    // Find top 3 delivery man
    app.get("/top-deliverymen", async (req, res) => {
      const topDeliverymen = await userCollection
        .find({ role: "deliveryman" })
        .sort({ numOfDeliveredParcel: -1, avarageRating: -1 })
        .limit(3)
        .toArray();

      res.send(topDeliverymen);

    });

    // Update deliveryman Id and approximate date
    app.patch("/setdeliveryman/:id", verifyToken, verifyAdmin, async (req, res) => {
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

    // get all reviews of a specific deliveryman
    app.get("/reviews/:id", async (req, res) => {
      const id = req.params.id
      const query = { deliveryMan: id }
      const reviews = await reviewCollection.find(query).toArray();
      res.send(reviews);
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



