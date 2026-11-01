const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MongoDB URI is missing!");
        }

        const connection = await mongoose.connect(
            process.env.MONGODB_URI,
            {
                serverSelectionTimeoutMS: 10000
            }
        );

        console.log("JEXOLYT database connected.");

    } catch (error) {
        console.error("Database connection failed:", error.name);
        throw error;
    }
};

module.exports = connectDB;