const express = require('express')
const app = express()
const cors = require('cors')
const morgan = require('morgan')
const jwt = require('jsonwebtoken')
require('dotenv').config()
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000

// middleware
const corsOptions = {
  origin: '*',
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())
app.use(morgan('dev'))

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3rhi256.mongodb.net/?retryWrites=true&w=majority`

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

// validate jwt
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization
  if(!authorization){
    return res.status(401).send({error: true, message: 'Unauthorized'})
  }
  const token = authorization.split(' ')[1]

  // token verify
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if(err){
      return res.status(401).send({error: true, message: 'Unauthorized access'})
    }
    req.decoded = decoded
  })

  next();
}

//  send email function
const sendMail = (emailData, emailAddress) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_NAME,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_NAME,
    to: emailAddress,
    subject: emailData.subject,
    html: `<p>${emailData.message}</p>`
  };

  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
   console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
      // do something useful
    }
  });
}

async function run() {
  try {
    const usersCollection = client.db('aircncDb').collection('users')
    const roomsCollection = client.db('aircncDb').collection('rooms')
    const bookingsCollection = client.db('aircncDb').collection('bookings')

    // Generate payment secret
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const {price} = req.body;
      if(price){
        const amount = parseFloat(price) * 100
      
    
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ['card'],
        
      })
      return res.send({
        clientSecret: paymentIntent.client_secret,
      });
    }
    
    });

    // Generate jwt token
    app.post('/jwt', async(req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN, {
        expiresIn: '1d'
      });
      res.send({token})
    })

// Save user Email and role im DB
    app.put('/users/:email', async(req, res) => {
        const email = req.params.email;
        const user = req.body;
        const query = {email: email}
        const options = {upsert: true}
        const updateDoc = {
            $set: user
        }
        const result = await usersCollection.updateOne(query, updateDoc, options)
        res.send(result);
    })

    // Get user
    app.get('/users/:email', async(req, res) => {
        const email = req.params.email;
        const query = {email: email}
        const result = await usersCollection.findOne(query)
        res.send(result);
    })
    

// save a room in database
app .post('/rooms', async(req, res) => {
    const room =req.body;
    const result = await roomsCollection.insertOne(room)
    res.send(result)
})

// update room in database
app.put('/rooms/:id', verifyJWT, async (req, res) => {
  const room = req.body;
  const id = req.params.id;
  const filter = {_id: new ObjectId(id)}
  const option = {upsert: true}
  const updateDoc = {
    $set: room,
  }
  const result = await roomsCollection.updateOne(filter, updateDoc, option)
  res.send(result)
})

// Update room booking status
app.patch('/rooms/status/:id', async(req, res) => {
    const id = req.params.id;
    const status = req.body.status;
    const query = {_id: new ObjectId(id)}
    const updateDoc = {
        $set: {
            booked: status,
        }
    }
    const update = await roomsCollection.updateOne(query, updateDoc)
    res.send(update);
})


// Get all rooms from db
app.get('/rooms', async(req, res) => {
    const result = await roomsCollection.find().toArray()
    res.send(result);
})

// delete room from db
app.delete('/rooms/:id', async(req, res) => {
    const id = req.params.id;
    const query = {_id: new ObjectId(id)}
    const result = await roomsCollection.deleteOne(query)
    res.send(result);
})

// Get a single rooms from db
app.get('/room/:id', async(req, res) => {
    const id = req.params.id;
    const query = {_id: new ObjectId(id)}
    const result = await roomsCollection.findOne(query)
    res.send(result);
})


// Get filter rooms for hosts
app.get('/rooms/:email', verifyJWT, async(req, res) => {
  const decodedEmail = req.decoded.email
    const email = req.params.email;
    if(email !== decodedEmail){
      return res.status(403).send({error: true, message: 'Forbidden access'})
    }
    const query = {'host.email': email}
    const result = await roomsCollection.find(query).toArray()
    res.send(result);
})

// Get Bookings for a guest by email
app.get('/bookings', async(req, res) => {
    const email = req.query.email;

    if(!email){
        res.send([])
    }

    const query = {'guest.email': email}
    const result = await bookingsCollection.find(query).toArray()
    res.send(result);
})

// Get Bookings for a host by email
app.get('/bookings/host', async(req, res) => {
    const email = req.query.email;

    if(!email){
        res.send([])
    }

    const query = {host: email}
    const result = await bookingsCollection.find(query).toArray()
    res.send(result);
})

// save a booking in database
app .post('/bookings', async(req, res) => {
    const booking =req.body;
    const result = await bookingsCollection.insertOne(booking)
    // send confirmation email to guest email account
    sendMail({
      subject: "Booking Successfully",
      message: `Booking Id: ${result?.insertedID}, TransactionId: ${booking.transactionId}`,
    },
    booking?.guest?.email
    )
    // send confirmation email to host email account
    sendMail({
      subject: "Booking Successfully",
      message: `Booking Id: ${result?.insertedID}, TransactionId: ${booking.transactionId}`,
    },
    booking?.host?.email
    )

    res.send(result)
})


// delete a booking from db
app.delete('/bookings/:id', async(req, res) => {
    const id = req.params.id;
    const query = {_id: new ObjectId(id)}
    const result = await bookingsCollection.deleteOne(query)
    res.send(result);
})


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('AirCNC Server is running..')
})

app.listen(port, () => {
  console.log(`AirCNC is running on port ${port}`)
})