const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();
const OpenAI = require('openai');
const AWS = require('aws-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Configure AWS S3
const s3Config = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
};
const s3 = new AWS.S3(s3Config);
const S3_BUCKET = process.env.S3_BUCKET_NAME;

// MongoDB Connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db;
let photosCollection;

async function connectToMongoDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        db = client.db('photo-description-app');
        photosCollection = db.collection('photos');
        return photosCollection;
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
}

// Ensure the database is connected
async function ensureDbConnected() {
    if (!photosCollection) {
        console.log('Database not connected yet, connecting now...');
        return await connectToMongoDB();
    }
    return photosCollection;
}

// Connect to MongoDB when the server starts
connectToMongoDB().catch(console.error);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), 'uploads');
try {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
} catch (error) {
    console.warn('Warning: Could not create uploads directory. This is expected in serverless environments.', error);
    // Continue execution - in serverless environments we'll handle files differently
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ storage: storage });

// AI-powered object detection function using OpenAI Vision API
async function detectObjectsInImage(imagePath) {
    try {
        // Read the image file and convert to base64
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Analyze this image and identify all visible objects in it. Be comprehensive and specific. For each object, include:\n\n1. The name of the object\n2. A confidence score between 0 and 1\n3. A brief description of the object's appearance\n4. The category it belongs to (e.g., furniture, electronic, food, clothing, etc.)\n\nRespond ONLY with a valid JSON array containing objects with this exact structure:\n[{\"name\": \"object_name\", \"confidence\": 0.95, \"description\": \"brief description\", \"category\": \"object_category\"}]\n\nDo not include any explanations, markdown formatting, or text outside of the JSON array."
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`,
                                detail: "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1500
        });

        // Ensure we got a valid response
        if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
            console.error('Invalid OpenAI response structure:', response);
            return getFallbackObjects();
        }

        const content = response.choices[0].message.content;

        // Make sure content is not empty
        if (!content || typeof content !== 'string') {
            console.error('Empty or invalid content in OpenAI response');
            return getFallbackObjects();
        }

        // Clean the response and try to parse JSON
        let cleanContent = content.trim();

        // Remove any markdown formatting if present
        if (cleanContent.startsWith('```json')) {
            cleanContent = cleanContent.replace(/```json\s*/, '').replace(/```\s*$/, '');
        } else if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.replace(/```\s*/, '').replace(/```\s*$/, '');
        }

        try {
            const objects = JSON.parse(cleanContent);
            console.log("Detected objects:", JSON.stringify(objects, null, 2));

            // Validate that objects is an array
            if (!Array.isArray(objects)) {
                console.error('OpenAI response is not an array:', objects);
                return getFallbackObjects();
            }

            // Validate each object has required properties
            const validObjects = objects.filter(obj =>
                obj && typeof obj === 'object' &&
                obj.name && typeof obj.name === 'string' &&
                typeof obj.confidence === 'number'
            );

            return validObjects;
        } catch (parseError) {
            console.error('Error parsing OpenAI response:', parseError);
            console.log('Raw response content:', content);
            // Fallback: extract object names from text response
            return extractObjectsFromText(content);
        }

    } catch (error) {
        console.error('Error with OpenAI Vision API:', error);
        // Fallback to basic object detection
        return getFallbackObjects();
    }
}

// Helper function to extract objects from text response if JSON parsing fails
function extractObjectsFromText(text) {
    const commonObjects = [
        'person', 'people', 'man', 'woman', 'child', 'baby',
        'car', 'vehicle', 'bicycle', 'motorcycle', 'bus', 'truck',
        'tree', 'plant', 'flower', 'grass', 'leaf',
        'building', 'house', 'window', 'door', 'wall',
        'table', 'chair', 'sofa', 'bed', 'desk',
        'phone', 'computer', 'laptop', 'screen', 'keyboard',
        'book', 'paper', 'pen', 'pencil',
        'cup', 'glass', 'bottle', 'plate', 'bowl',
        'food', 'fruit', 'apple', 'banana', 'orange',
        'dog', 'cat', 'bird', 'animal',
        'sky', 'cloud', 'sun', 'moon', 'star',
        'water', 'river', 'lake', 'ocean', 'beach',
        'mountain', 'hill', 'rock', 'stone',
        'road', 'street', 'path', 'bridge',
        'light', 'lamp', 'candle', 'fire',
        'bag', 'backpack', 'suitcase', 'box',
        'clock', 'watch', 'mirror', 'picture'
    ];

    const foundObjects = [];
    const lowerText = text.toLowerCase();

    commonObjects.forEach(obj => {
        if (lowerText.includes(obj)) {
            foundObjects.push({
                name: obj,
                confidence: 0.8,
                description: `Detected ${obj} in the image`
            });
        }
    });

    return foundObjects.slice(0, 8); // Limit to 8 objects
}

// Fallback function for when AI detection fails
function getFallbackObjects() {
    const fallbackObjects = [
        { name: 'unknown_object_1', confidence: 0.5, description: 'Object detected but not identified' },
        { name: 'unknown_object_2', confidence: 0.5, description: 'Object detected but not identified' }
    ];
    return fallbackObjects;
}

// Routes

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload and process photo
app.post('/api/upload', upload.single('photo'), async (req, res) => {
    try {
        console.log('Upload endpoint called');

        if (!req.file) {
            console.log('No file uploaded');
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);

        const photoId = uuidv4();
        const filename = req.file.filename;
        const fileKey = `photos/${photoId}`;

        console.log('Generated photoId:', photoId);

        try {
            // Upload file to storage
            const fileInfo = await uploadFile(req.file, filename);
            console.log('File uploaded to:', fileInfo.storage);

            // Get the local path for AI processing
            let imagePath;
            if (fileInfo.isLocal) {
                imagePath = path.join(process.cwd(), 'uploads', filename);
            } else {
                // If using storage, we still have the local file until it's deleted after upload
                imagePath = req.file.path;
            }

            console.log('Using image path for AI:', imagePath);

            try {
                // Use AI to detect objects in the image
                const detectedObjects = await detectObjectsInImage(imagePath);
                console.log('AI detection complete, objects found:', detectedObjects.length);

                // Create a description from detected objects
                const objectNames = detectedObjects.map(obj => obj.name).join(', ');
                const description = detectedObjects.length > 0
                    ? `Objects detected: ${objectNames}`
                    : 'No specific objects detected';

                // Create metadata with detected objects
                const metadata = {
                    id: photoId,
                    originalName: req.file.originalname,
                    filename: fileInfo.key,
                    fileUrl: fileInfo.url,
                    isLocalStorage: fileInfo.isLocal,
                    size: req.file.size,
                    mimetype: req.file.mimetype,
                    description: description,
                    detectedObjects: detectedObjects,
                    objectCategories: [...new Set(detectedObjects.map(obj => obj.category || 'Uncategorized'))],
                    analysisTimestamp: new Date().toISOString(),
                    uploadedAt: new Date().toISOString()
                };

                console.log('Saving to MongoDB...');

                // Ensure DB connection is established
                const collection = await ensureDbConnected();

                // Store in MongoDB
                try {
                    const result = await collection.insertOne({
                        _id: photoId,
                        filename: fileInfo.key,
                        fileUrl: fileInfo.url,
                        isLocalStorage: fileInfo.isLocal,
                        description: description,
                        metadata: metadata,
                        created_at: new Date()
                    });

                    console.log('MongoDB save successful:', result.insertedId);

                    return res.json({
                        success: true,
                        data: metadata
                    });
                } catch (dbError) {
                    console.error('Database error:', dbError);
                    return res.status(500).json({ success: false, error: 'Database error: ' + dbError.message });
                }
            } catch (aiError) {
                console.error('Error processing image with AI:', aiError);

                // Fallback to basic metadata if AI processing fails
                const metadata = {
                    id: photoId,
                    originalName: req.file.originalname,
                    filename: fileKey,
                    fileUrl: fileInfo.url,
                    isLocalStorage: fileInfo.isLocal,
                    size: req.file.size,
                    mimetype: req.file.mimetype,
                    description: 'Image uploaded successfully',
                    detectedObjects: [],
                    objectCategories: [],
                    analysisTimestamp: null,
                    uploadedAt: new Date().toISOString(),
                    error: 'Object detection failed'
                };

                try {
                    // Ensure DB connection is established
                    const collection = await ensureDbConnected();

                    const result = await collection.insertOne({
                        _id: photoId,
                        filename: fileKey,
                        fileUrl: fileInfo.url,
                        isLocalStorage: fileInfo.isLocal,
                        description: metadata.description,
                        metadata: metadata,
                        created_at: new Date()
                    });

                    return res.json({
                        success: true,
                        data: metadata
                    });
                } catch (dbError) {
                    console.error('Database error:', dbError);
                    return res.status(500).json({ success: false, error: 'Database error: ' + dbError.message });
                }
            }
        } catch (error) {
            console.error('Error processing image:', error);
            return res.status(500).json({ success: false, error: 'Server error: ' + (error.message || 'Unknown error') });
        }
    } catch (error) {
        console.error('Unexpected error in upload endpoint:', error);
        return res.status(500).json({ success: false, error: 'Server error: ' + (error.message || 'Unknown error') });
    }
});

// Get all photos
app.get('/api/photos', async (req, res) => {
    try {
        // Ensure DB connection is established
        const collection = await ensureDbConnected();

        const photos = await collection.find({})
            .sort({ created_at: -1 })
            .toArray();

        res.json(photos.map(photo => ({
            id: photo._id,
            filename: photo.filename,
            fileUrl: photo.fileUrl || `/uploads/${photo.filename}`,
            isLocalStorage: photo.isLocalStorage || true,
            description: photo.description,
            metadata: photo.metadata,
            created_at: photo.created_at
        })));
    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ success: false, error: 'Database error: ' + error.message });
    }
});

// Get specific photo
app.get('/api/photos/:id', async (req, res) => {
    const photoId = req.params.id;

    try {
        // Ensure DB connection is established
        const collection = await ensureDbConnected();

        const photo = await collection.findOne({ _id: photoId });

        if (!photo) {
            return res.status(404).json({ success: false, error: 'Photo not found' });
        }

        res.json({
            id: photo._id,
            filename: photo.filename,
            fileUrl: photo.fileUrl || `/uploads/${photo.filename}`,
            isLocalStorage: photo.isLocalStorage || true,
            description: photo.description,
            metadata: photo.metadata,
            created_at: photo.created_at
        });
    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ success: false, error: 'Database error: ' + error.message });
    }
});

// Serve uploaded images
app.get('/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(process.cwd(), 'uploads', filename);

    try {
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            console.error(`File not found: ${filePath}`);
            res.status(404).json({ success: false, error: 'Image not found' });
        }
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).json({ success: false, error: 'Error serving image' });
    }
});

// Delete photo
app.delete('/api/photos/:id', async (req, res) => {
    const photoId = req.params.id;

    try {
        // Ensure DB connection is established
        const collection = await ensureDbConnected();

        // First get the photo to delete the file
        const photo = await collection.findOne({ _id: photoId });

        if (photo) {
            // Delete file from storage
            try {
                const fileInfo = {
                    isLocal: photo.isLocalStorage,
                    key: photo.filename,
                    url: photo.fileUrl,
                    storage: photo.metadata.storage || (photo.isLocalStorage ? 'local' : 'blob')
                };

                const result = await deleteFile(fileInfo);

                if (result) {
                    // Delete from database
                    const deleteResult = await collection.deleteOne({ _id: photoId });
                    res.json({ success: true, deletedId: photoId });
                } else {
                    return res.status(500).json({ success: false, error: 'Error deleting file' });
                }
            } catch (error) {
                console.error('Error deleting file:', error);
                return res.status(500).json({ success: false, error: 'Error deleting file' });
            }
        } else {
            return res.status(404).json({ success: false, error: 'Photo not found' });
        }
    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ success: false, error: 'Database error: ' + error.message });
    }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Make uploads directory accessible
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Function to upload file to AWS S3
async function uploadFileToS3(file, key) {
    try {
        console.log('Starting file upload to S3:', key);

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.S3_BUCKET_NAME) {
            console.log('S3 credentials not found, falling back to local storage');
            return null; // Return null to indicate fallback should be used
        }

        // Read file data
        const fileData = fs.readFileSync(file.path);

        // Upload to S3
        const params = {
            Bucket: S3_BUCKET,
            Key: key,
            Body: fileData,
            ContentType: file.mimetype,
            ACL: 'public-read' // Make file publicly accessible
        };

        console.log(`Uploading to S3 bucket: ${S3_BUCKET}, key: ${key}`);
        const data = await s3.upload(params).promise();
        console.log('S3 upload successful:', data.Location);

        // Delete local file after successful upload
        try {
            fs.unlinkSync(file.path);
        } catch (unlinkError) {
            console.warn('Could not delete local file after S3 upload:', unlinkError);
        }

        return {
            isLocal: false,
            key: key,
            url: data.Location,
            storage: 's3'
        };
    } catch (error) {
        console.error('Error uploading to S3:', error);
        return null; // Return null to indicate fallback should be used
    }
}

// Function to upload file to storage (tries S3 first, then local)
async function uploadFile(file, filename) {
    try {
        console.log('Starting file upload process for:', filename);

        // Try S3 first if configured
        if (process.env.AWS_ACCESS_KEY_ID && process.env.S3_BUCKET_NAME) {
            const fileExtension = path.extname(file.originalname);
            const s3Key = `${filename}${fileExtension}`;
            const s3Result = await uploadFileToS3(file, s3Key);

            if (s3Result) {
                console.log('Successfully uploaded to S3');
                return s3Result;
            }
            console.log('S3 upload failed, falling back to local storage...');
        }

        // Fallback to local storage if S3 fails or is not configured
        console.log('Using local filesystem for storage');
        return {
            isLocal: true,
            key: file.filename,
            url: `/uploads/${file.filename}`,
            storage: 'local'
        };
    } catch (error) {
        console.error('Error in file upload process:', error);

        // Ultimate fallback to local storage
        return {
            isLocal: true,
            key: file.filename,
            url: `/uploads/${file.filename}`,
            storage: 'local',
            error: error.message
        };
    }
}

// Function to delete file from storage
async function deleteFile(fileInfo) {
    try {
        // Check storage type and call appropriate delete method
        if (fileInfo.isLocal) {
            // Delete from local filesystem
            const filename = fileInfo.key;
            const filePath = path.join(process.cwd(), 'uploads', filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('Deleted local file:', filename);
            }
            return true;
        } else if (fileInfo.storage === 's3') {
            // Delete from S3
            const params = {
                Bucket: S3_BUCKET,
                Key: fileInfo.key
            };
            await s3.deleteObject(params).promise();
            console.log('Deleted S3 file:', fileInfo.key);
            return true;
        }

        return false;
    } catch (error) {
        console.error('Error deleting file:', error);
        return false;
    }
}

// Start server with port fallback mechanism
const startServer = () => {
    // Find an available port
    const findAvailablePort = (port) => {
        return new Promise((resolve, reject) => {
            const server = require('http').createServer();

            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    // Port is in use, try the next one
                    console.log(`Port ${port} is busy, trying port ${port + 1}...`);
                    resolve(findAvailablePort(port + 1));
                } else {
                    reject(err);
                }
            });

            server.on('listening', () => {
                // Port is available, close the server and return the port
                server.close();
                resolve(port);
            });

            server.listen(port);
        });
    };

    // Find an available port starting from PORT and then start the app
    findAvailablePort(PORT)
        .then((availablePort) => {
            app.listen(availablePort, () => {
                console.log(`Server running on http://localhost:${availablePort}`);
            });
        })
        .catch((err) => {
            console.error('Error finding available port:', err);
        });
};

// Only start the server if not in a serverless environment (like Vercel)
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    startServer();
}

// Graceful shutdown
process.on('SIGINT', async () => {
    try {
        await client.close();
        console.log('MongoDB connection closed.');
        process.exit(0);
    } catch (error) {
        console.error('Error closing MongoDB connection:', error);
        process.exit(1);
    }
});

// For Vercel serverless deployment
module.exports = app;
