"use strict";

const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const crypto = require("crypto");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
// --------------------------------------------------
// FRONTEND
// --------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

// --------------------------------------------------
// Supabase
// --------------------------------------------------

if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
    console.error("❌ Missing Supabase environment variables.");
    process.exit(1);
}

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(express.json());

app.use(express.static(
    path.join(__dirname, "public")
));

// Store uploaded images temporarily in memory.
// They will then be sent directly to Supabase.
const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

// --------------------------------------------------
// DEVICE
// --------------------------------------------------

app.post("/api/device", async (req, res) => {
    try {
        const userAgent =
            typeof req.body.user_agent === "string"
                ? req.body.user_agent.slice(0, 500)
                : "";

        // Generate a random device ID.
        const deviceId = crypto.randomUUID();

        // Get the client's IP address.
        const ipAddress =
            req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
            req.socket.remoteAddress ||
            "";

        // Save the device in Supabase.
        const { error } = await supabase
            .from("devices")
            .insert({
                uuid: deviceId,
                ip_address: ipAddress
            });

        if (error) {
            console.error("Device database error:", error);

            return res.status(500).json({
                error: "Could not save device."
            });
        }

        console.log(`📱 Device registered: ${deviceId}`);

        res.json({
            success: true,
            device_id: deviceId
        });

    } catch (error) {
        console.error("Device error:", error);

        res.status(500).json({
            error: "Could not register device."
        });
    }
});


// --------------------------------------------------
// IMAGE UPLOAD
// --------------------------------------------------

app.post(
    "/api/upload",
    upload.single("image"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    error: "No image was uploaded."
                });

            }

            const deviceId =
                typeof req.body.device_id === "string"
                    ? req.body.device_id.slice(0, 100)
                    : "unknown";

            const playerName =
                typeof req.body.player_name === "string"
                    ? req.body.player_name.trim().slice(0, 25)
                    : "Player";

            // Only allow actual image MIME types.
            const allowedTypes = [
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/gif"
            ];

            if (
                !allowedTypes.includes(
                    req.file.mimetype
                )
            ) {

                return res.status(400).json({
                    error: "Unsupported image type."
                });

            }

            // Generate a safe filename.
            const extension =
                getExtension(
                    req.file.mimetype
                );

            const filename =
                `${crypto.randomUUID()}${extension}`;

            const safeDeviceId =
                deviceId.replace(
                    /[^a-zA-Z0-9_-]/g,
                    "_"
                );

            const filePath =
                `devices/${safeDeviceId}/${filename}`;

            console.log(
                `📤 Uploading ${playerName}'s image: ${filePath}`
            );

            // Upload to Supabase Storage.
            const {
                error: uploadError
            } = await supabase
                .storage
                .from("puzzle-images")
                .upload(
                    filePath,
                    req.file.buffer,
                    {
                        contentType:
                            req.file.mimetype,

                        upsert: false
                    }
                );

            if (uploadError) {

                console.error(
                    "Supabase upload error:",
                    uploadError
                );

                return res.status(500).json({
                    error:
                        "Could not upload image to Supabase."
                });

            }

            // Because the bucket can be private,
            // create a signed URL.
            const {
                data: signedUrlData,
                error: signedUrlError
            } = await supabase
                .storage
                .from("puzzle-images")
                .createSignedUrl(
                    filePath,
                    60 * 60 * 24
                );

            if (signedUrlError) {

                console.error(
                    "Signed URL error:",
                    signedUrlError
                );

                return res.status(500).json({
                    error:
                        "Image uploaded, but URL creation failed."
                });

            }

            res.json({

                success: true,

                path: filePath,

                url:
                    signedUrlData.signedUrl

            });

        } catch (error) {

            console.error(
                "Upload error:",
                error
            );

            res.status(500).json({
                error: "Image upload failed."
            });

        }

    }
);

// --------------------------------------------------
// EXTENSION
// --------------------------------------------------

function getExtension(mimeType) {

    const extensions = {

        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif"

    };

    return extensions[mimeType] || ".img";

}

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(
    PORT,
    () => {

        console.log("");
        console.log("🧩 PuzzleMaster backend running!");
        console.log(
            `🌐 http://localhost:${PORT}`
        );
        console.log("");

    }
);
