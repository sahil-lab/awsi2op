# Image Object Detection App

This application takes photos, uses OpenAI's Vision model to detect objects, and stores the data in MongoDB.

## Features

- Take photos using device camera
- Upload photos from device
- Detect objects in images using OpenAI's Vision API
- Store photos and object data in MongoDB
- View analysis of detected objects in a tabular format

## Deployment to Vercel

### Method 1: Using Vercel CLI

1. Install Vercel CLI (if not already installed):
   ```
   npm install -g vercel
   ```

2. Login to Vercel:
   ```
   vercel login
   ```

3. Deploy to Vercel:
   ```
   vercel
   ```

4. Follow the prompts to complete the deployment.

### Method 2: Using Vercel Dashboard

1. Push your code to a GitHub repository.
2. Go to [Vercel Dashboard](https://vercel.com/dashboard).
3. Click "New Project" and import your repository.
4. Configure the following environment variables:
   - `MONGODB_URI`: Your MongoDB connection string
   - `OPENAI_API_KEY`: Your OpenAI API key
5. Click "Deploy".

### Important Notes for Vercel Deployment

- This application uses local file storage for images, which will not persist on Vercel's serverless environment.
- Each new serverless function invocation will have a fresh filesystem.
- For production use, consider modifying the app to use cloud storage solutions like AWS S3 or Cloudinary.

## Local Development

1. Install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file with:
   ```
   MONGODB_URI=your_mongodb_connection_string
   OPENAI_API_KEY=your_openai_api_key
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open http://localhost:3000 in your browser.
