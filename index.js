const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()

const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000;


// middleware
app.use(cors());
app.use(express.json());
const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' });
        }
        req.decoded = decoded;
        next();
    });
};



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wfbcpzp.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const usersCollection = client.db('summerCamp').collection('users');
        const ClassCollection = client.db('summerCamp').collection('classes');
        const ClassCartCollection = client.db('summerCamp').collection('classesCart');
        const EnrolledClassCollection = client.db('summerCamp').collection('enrolledClass');


        // jwt related api
        app.post('/jwt', (req, res) => {
            const user = req.body
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })

        // admin verify middleware 
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(401).send({ error: true, message: 'forbidden message' });
            }
            next()
        }
        // admin teacher middleware 
        const verifyTeacher = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'teacher') {
                return res.status(401).send({ error: true, message: 'forbidden message' });
            }
            next()
        }


        // users API
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        })


        app.post('/users', async (req, res) => {
            const user = req.body;
            // Set default role to "student"
            user.role = 'student';

            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists' });
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });


        // store all classes
        app.post('/classes', verifyJWT, verifyTeacher, async (req, res) => {
            const classes = req.body
            classes.status = 'pending'
            classes.enrollCount = 0
            const result = await ClassCollection.insertOne(classes)
            res.send(result)
        })

        // Get all approved classes
        app.get('/classes/approved', async (req, res) => {
            try {
                const classes = await ClassCollection.find({ status: 'approved' }).toArray();
                res.send(classes);
            } catch (error) {
                res.status(500).json({ error: 'Error fetching approved classes' });
            }
        });

        // Get my classes
        app.get('/classes/:email', verifyJWT, verifyTeacher, async (req, res) => {
            const email = req.params.email;
            const result = await ClassCollection.find({ instructorEmail: email }).toArray();
            res.send(result);
        });


        // Get all classes
        app.get('/classes', async (req, res) => {
            const classes = await ClassCollection.find().toArray();
            res.send(classes);
        });






        // selected class collection with duplication handeling
        app.post("/classcart", async (req, res) => {
            const classItem = req.body;

            if (!classItem || !classItem.name || !classItem.userEmail) {
                return res.status(400).send({ error: "Invalid request body" });
            }

            try {
                // Check if the class item already exists for the user
                const existingItem = await ClassCartCollection.findOne({
                    name: classItem.name,
                    userEmail: classItem.userEmail,
                });

                if (existingItem) {
                    return res.status(400).send({ error: "Class item already exists" });
                }

                // Save the class item to the database
                const result = await ClassCartCollection.insertOne(classItem);
                res.send({ insertedId: result.insertedId });
            } catch (error) {
                console.error("Error adding class item:", error);
                res.status(500).send({ error: "Error adding class item" });
            }
        });



        // get classItem for each user
        app.get('/classcart', async (req, res) => {
            const userEmail = req.query.email;
            console.log('single user data', userEmail)

            if (!userEmail) {
                res.send([]);
            }

            // const decodedEmail = req.decoded.email;
            // if (email !== decodedEmail) {
            //     return res.status(403).send({ error: true, message: 'forbidden access' })
            // }

            const query = { userEmail: userEmail };
            const result = await ClassCartCollection.find(query).toArray();
            res.send(result);
        });

        // get enrolled item for each user 
        app.get('/enrolledclass', async (req, res) => {
            const userEmail = req.query.email;
            console.log('single user data', userEmail)

            if (!userEmail) {
                res.send([]);
            }

            // const decodedEmail = req.decoded.email;
            // if (email !== decodedEmail) {
            //     return res.status(403).send({ error: true, message: 'forbidden access' })
            // }

            const query = { userEmail: userEmail };
            const result = await EnrolledClassCollection.find(query).toArray();
            res.send(result);
        });

        // delete classItem 
        app.delete('/classcart/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ClassCartCollection.deleteOne(query);
            res.send(result);
        })

        // create payment intent //////////////////
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            // console.log(amount, price);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });



        // Update enrollCount and availableSeats on successful payment
        app.patch('/classesCart/:id/success', async (req, res) => {
            const itemId = req.params.id;
            try {
                // Find the class item in the classesCart collection
                const classItem = await ClassCartCollection.findOne({ _id: new ObjectId(itemId) });
                if (!classItem) {
                    return res.status(404).send({ error: 'Class item not found' });
                }

                // Update the enrollCount and availableSeats in the corresponding class
                const className = classItem.name;
                const filter = { name: className };
                const updateDoc = {
                    $inc: { enrollCount: 1, availableSeats: -1 },
                };

                const result = await ClassCollection.updateOne(filter, updateDoc);

                if (result.matchedCount === 0) {
                    return res.status(404).send({ error: 'Class not found' });
                }

                res.send({ message: 'Class item updated successfully' });
            } catch (error) {
                console.error('Error updating class item:', error);
                res.status(500).send({ error: 'Failed to update class item' });
            }
        });


       
        //  store selected item and transaction ID
        

        app.post('/enrolledclass', async (req, res) => {
          const { selectedItem, trxId } = req.body;
        
          // Add trxId to the selectedItem object
          selectedItem.trxId = trxId;
        
          // Create a new document in the EnrolledClassCollection
          const result = await EnrolledClassCollection.insertOne(selectedItem);
        
          res.send(result);
        });
        





        // ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
        // secure admin
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            if (req.decoded.email !== email) {
                return res.send({ admin: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })

        // secure teacher
        app.get('/users/teacher/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            console.log(email)
            if (req.decoded.email !== email) {
                return res.send({ teacher: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const result = { teacher: user?.role === 'teacher' }
            res.send(result)
        })

        // secure student
        app.get('/users/student/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            console.log(email)
            if (req.decoded.email !== email) {
                return res.send({ teacher: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const result = { student: user?.role === 'student' }
            res.send(result)
        })
        // /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

        // make admin api
        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        })

        // make teacher api
        app.patch('/users/teacher/:id', async (req, res) => {
            const id = req.params.id
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'teacher'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result)
        })

        // make status approved
        app.patch('/classes/approve/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'approved',
                },
            };
            const result = await ClassCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // make status denied
        app.patch('/classes/deny/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'denied',
                },
            };
            const result = await ClassCollection.updateOne(filter, updateDoc);
            res.send(result);
        });




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('summer camp is  on')
})

app.listen(port, () => {
    console.log(`summer camp is  on port ${port}`);
})


