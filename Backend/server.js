"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");

const {
    createClient
} = require("@supabase/supabase-js");


/* =========================================================
   CONFIGURATION
========================================================= */

const PORT =
    process.env.PORT || 3000;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;


/* =========================================================
   VALIDATE ENVIRONMENT
========================================================= */

if (!SUPABASE_URL) {

    console.error(
        "❌ Missing SUPABASE_URL in .env"
    );

    process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {

    console.error(
        "❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env"
    );

    process.exit(1);
}


/* =========================================================
   SUPABASE
========================================================= */

const supabase =
    createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    );


/* =========================================================
   EXPRESS
========================================================= */

const app =
    express();


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "2mb"
    })
);

app.use(
    cookieParser()
);


/* =========================================================
   MULTER
   Keep uploaded images in memory temporarily.
   They will immediately be uploaded to Supabase Storage.
========================================================= */

const upload =
    multer({
        storage: multer.memoryStorage(),

        limits: {
            fileSize: 10 * 1024 * 1024
        },

        fileFilter:
            (req, file, cb) => {

                if (
                    file.mimetype &&
                    file.mimetype.startsWith(
                        "image/"
                    )
                ) {

                    cb(null, true);

                } else {

                    cb(
                        new Error(
                            "Only image files are allowed."
                        )
                    );
                }
            }
    });


/* =========================================================
   CONSTANTS
========================================================= */

const DEVICE_COOKIE =
    "puzzlemaster_device_id";

const PHOTO_BUCKET =
    "puzzlemaster-photos";


/* =========================================================
   HELPERS
========================================================= */


/*
 * Generate a UUID.
 */
function generateDeviceId() {

    return crypto.randomUUID();
}


/*
 * Generate a random storage filename.
 */
function generateStorageName(
    originalName
) {

    const extension =
        path.extname(
            originalName || ""
        ).toLowerCase() ||
        ".jpg";

    return (
        Date.now() +
        "-" +
        crypto.randomBytes(8).toString("hex") +
        extension
    );
}


/*
 * Safely convert a value to string.
 */
function cleanString(
    value,
    maxLength = 100
) {

    if (
        typeof value !== "string"
    ) {

        return "";
    }

    return value
        .trim()
        .slice(0, maxLength);
}


/*
 * Get device ID from:
 *
 * 1. Cookie
 * 2. Request body
 *
 * If neither exists, create one.
 */
function getOrCreateDeviceId(
    req,
    res
) {

    let deviceId =
        cleanString(
            req.cookies?.[
                DEVICE_COOKIE
            ],
            100
        );

    if (!deviceId) {

        deviceId =
            cleanString(
                req.body?.deviceId,
                100
            );
    }

    /*
     * Validate UUID.
     */
    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
        !uuidPattern.test(
            deviceId
        )
    ) {

        deviceId =
            generateDeviceId();
    }


    /*
     * Store device ID in an HTTP-only cookie.
     *
     * This means the browser automatically sends
     * it on future requests.
     */
    res.cookie(
        DEVICE_COOKIE,
        deviceId,
        {
            httpOnly: true,
            sameSite: "lax",
            secure:
                process.env.NODE_ENV ===
                "production",

            maxAge:
                1000 *
                60 *
                60 *
                24 *
                365 *
                5
        }
    );

    return deviceId;
}


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            success: true,
            message:
                "PuzzleMaster backend is running.",
            timestamp:
                new Date().toISOString()
        });
    }
);


/* =========================================================
   DEVICE INITIALIZATION
========================================================= */

/*
 * IMPORTANT:
 *
 * This is the endpoint your frontend should call:
 *
 * POST /api/device
 *
 * It fixes the 405 issue when the frontend uses POST.
 */
app.post(
    "/api/device",
    async (req, res) => {

        try {

            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            /*
             * Check whether device already exists.
             */
            const {
                data: existingDevice,
                error: findError
            } =
                await supabase
                    .from("devices")
                    .select("*")
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .maybeSingle();


            if (findError) {

                console.error(
                    "Device lookup error:",
                    findError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to check device."
                });
            }


            /*
             * Existing device.
             */
            if (existingDevice) {

                return res.json({

                    success: true,

                    existing: true,

                    device: existingDevice
                });
            }


            /*
             * New device.
             */
            const ipAddress =
                req.headers[
                    "x-forwarded-for"
                ]
                ?.split(",")[0]
                ?.trim() ||
                req.socket.remoteAddress ||
                null;


            const userAgent =
                cleanString(
                    req.headers[
                        "user-agent"
                    ],
                    500
                );


            const {
                data: newDevice,
                error: insertError
            } =
                await supabase
                    .from("devices")
                    .insert({

                        device_id:
                            deviceId,

                        ip_address:
                            ipAddress,

                        user_agent:
                            userAgent

                    })
                    .select()
                    .single();


            if (insertError) {

                console.error(
                    "Device insert error:",
                    insertError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to create device."
                });
            }


            return res.status(201).json({

                success: true,

                existing: false,

                device: newDevice
            });

        } catch (error) {

            console.error(
                "POST /api/device error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Device initialization failed."
            });
        }
    }
);


/* =========================================================
   OPTIONAL GET DEVICE ENDPOINT
========================================================= */

/*
 * This is also provided intentionally.
 *
 * If your frontend accidentally uses GET instead of POST,
 * it won't produce a 405.
 */
app.get(
    "/api/device",
    async (req, res) => {

        try {

            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            const {
                data,
                error
            } =
                await supabase
                    .from("devices")
                    .select("*")
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .maybeSingle();


            if (error) {

                console.error(
                    "GET device error:",
                    error
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to retrieve device."
                });
            }


            if (data) {

                return res.json({

                    success: true,

                    existing: true,

                    device: data
                });
            }


            const ipAddress =
                req.headers[
                    "x-forwarded-for"
                ]
                ?.split(",")[0]
                ?.trim() ||
                req.socket.remoteAddress ||
                null;


            const userAgent =
                cleanString(
                    req.headers[
                        "user-agent"
                    ],
                    500
                );


            const {
                data: newDevice,
                error: insertError
            } =
                await supabase
                    .from("devices")
                    .insert({

                        device_id:
                            deviceId,

                        ip_address:
                            ipAddress,

                        user_agent:
                            userAgent

                    })
                    .select()
                    .single();


            if (insertError) {

                console.error(
                    "GET device insert error:",
                    insertError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to create device."
                });
            }


            return res.status(201).json({

                success: true,

                existing: false,

                device: newDevice
            });

        } catch (error) {

            console.error(
                "GET /api/device error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Device request failed."
            });
        }
    }
);


/* =========================================================
   CREATE GAME SESSION
========================================================= */

app.post(
    "/api/game",
    async (req, res) => {

        try {

            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            const playerName =
                cleanString(
                    req.body?.playerName,
                    25
                );


            const difficulty =
                cleanString(
                    req.body?.difficulty,
                    30
                );


            const maxMoves =
                Number(
                    req.body?.maxMoves
                );


            if (!playerName) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Player name is required."
                });
            }


            if (
                !Number.isInteger(
                    maxMoves
                ) ||
                maxMoves <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Maximum moves must be a positive number."
                });
            }


            /*
             * Make sure device exists.
             */
            const {
                data: device,
                error: deviceError
            } =
                await supabase
                    .from("devices")
                    .select("device_id")
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .maybeSingle();


            if (deviceError) {

                console.error(
                    deviceError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Could not verify device."
                });
            }


            if (!device) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Device has not been initialized."
                });
            }


            /*
             * Create game.
             */
            const {
                data: game,
                error: gameError
            } =
                await supabase
                    .from("game_sessions")
                    .insert({

                        device_id:
                            deviceId,

                        player_name:
                            playerName,

                        difficulty:
                            difficulty,

                        max_moves:
                            maxMoves

                    })
                    .select()
                    .single();


            if (gameError) {

                console.error(
                    "Game creation error:",
                    gameError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to create game session."
                });
            }


            return res.status(201).json({

                success: true,

                game
            });

        } catch (error) {

            console.error(
                "POST /api/game error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Failed to create game."
            });
        }
    }
);


/* =========================================================
   UPDATE GAME SESSION
========================================================= */

app.patch(
    "/api/game/:gameId",
    async (req, res) => {

        try {

            const gameId =
                cleanString(
                    req.params.gameId,
                    100
                );


            if (!gameId) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Game ID is required."
                });
            }


            const updates = {};


            if (
                req.body.moves !==
                undefined
            ) {

                const moves =
                    Number(
                        req.body.moves
                    );

                if (
                    !Number.isInteger(
                        moves
                    ) ||
                    moves < 0
                ) {

                    return res.status(400).json({

                        success: false,

                        error:
                            "Invalid moves value."
                    });
                }

                updates.moves =
                    moves;
            }


            if (
                req.body.maxMoves !==
                undefined
            ) {

                const maxMoves =
                    Number(
                        req.body.maxMoves
                    );

                if (
                    !Number.isInteger(
                        maxMoves
                    ) ||
                    maxMoves <= 0
                ) {

                    return res.status(400).json({

                        success: false,

                        error:
                            "Invalid maximum moves value."
                    });
                }

                updates.max_moves =
                    maxMoves;
            }


            if (
                req.body.time !==
                undefined
            ) {

                const time =
                    Number(
                        req.body.time
                    );

                if (
                    !Number.isFinite(
                        time
                    ) ||
                    time < 0
                ) {

                    return res.status(400).json({

                        success: false,

                        error:
                            "Invalid time value."
                    });
                }

                updates.time_seconds =
                    Math.floor(time);
            }


            if (
                req.body.score !==
                undefined
            ) {

                const score =
                    Number(
                        req.body.score
                    );

                if (
                    !Number.isFinite(
                        score
                    )
                ) {

                    return res.status(400).json({

                        success: false,

                        error:
                            "Invalid score value."
                    });
                }

                updates.score =
                    Math.round(score);
            }


            if (
                req.body.status !==
                undefined
            ) {

                const allowedStatuses = [
                    "playing",
                    "won",
                    "lost",
                    "abandoned"
                ];

                const status =
                    cleanString(
                        req.body.status,
                        30
                    );

                if (
                    !allowedStatuses.includes(
                        status
                    )
                ) {

                    return res.status(400).json({

                        success: false,

                        error:
                            "Invalid game status."
                    });
                }

                updates.status =
                    status;
            }


            if (
                req.body.movesUsed !==
                undefined
            ) {

                updates.moves =
                    Number(
                        req.body.movesUsed
                    );
            }


            if (
                req.body.completed ===
                true
            ) {

                updates.status =
                    "won";

                updates.completed_at =
                    new Date().toISOString();
            }


            if (
                req.body.failed ===
                true
            ) {

                updates.status =
                    "lost";

                updates.completed_at =
                    new Date().toISOString();
            }


            if (
                Object.keys(updates).length ===
                0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "No updates supplied."
                });
            }


            const {
                data,
                error
            } =
                await supabase
                    .from("game_sessions")
                    .update(updates)
                    .eq(
                        "id",
                        gameId
                    )
                    .select()
                    .single();


            if (error) {

                console.error(
                    "Game update error:",
                    error
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to update game."
                });
            }


            return res.json({

                success: true,

                game: data
            });

        } catch (error) {

            console.error(
                "PATCH game error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Game update failed."
            });
        }
    }
);


/* =========================================================
   PHOTO UPLOAD
========================================================= */

app.post(
    "/api/upload-photo",
    upload.single("photo"),

    async (req, res) => {

        try {

            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    error:
                        "No photo was uploaded."
                });
            }


            const gameId =
                cleanString(
                    req.body?.gameId,
                    100
                );


            const playerName =
                cleanString(
                    req.body?.playerName,
                    25
                );


            /*
             * Make a unique storage path.
             */
            const filename =
                generateStorageName(
                    req.file.originalname
                );


            const storagePath =
                `${deviceId}/${filename}`;


            /*
             * Upload to Supabase Storage.
             */
            const {
                error: uploadError
            } =
                await supabase
                    .storage
                    .from(
                        PHOTO_BUCKET
                    )
                    .upload(
                        storagePath,
                        req.file.buffer,
                        {
                            contentType:
                                req.file.mimetype,

                            cacheControl:
                                "3600",

                            upsert: false
                        }
                    );


            if (uploadError) {

                console.error(
                    "Storage upload error:",
                    uploadError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to upload photo."
                });
            }


            /*
             * Create a signed URL.
             *
             * This works even when the bucket is private.
             */
            const {
                data: signedData,
                error: signedError
            } =
                await supabase
                    .storage
                    .from(
                        PHOTO_BUCKET
                    )
                    .createSignedUrl(
                        storagePath,
                        60 * 60 * 24
                    );


            if (signedError) {

                console.error(
                    "Signed URL error:",
                    signedError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Photo uploaded, but URL generation failed."
                });
            }


            /*
             * Store photo metadata in database.
             */
            const {
                data: photoRecord,
                error: photoError
            } =
                await supabase
                    .from("photos")
                    .insert({

                        device_id:
                            deviceId,

                        game_id:
                            gameId || null,

                        player_name:
                            playerName ||
                            null,

                        storage_path:
                            storagePath,

                        original_name:
                            req.file.originalname,

                        mime_type:
                            req.file.mimetype,

                        file_size:
                            req.file.size

                    })
                    .select()
                    .single();


            if (photoError) {

                console.error(
                    "Photo metadata error:",
                    photoError
                );

                /*
                 * Try to remove uploaded file
                 * if metadata insertion fails.
                 */
                await supabase
                    .storage
                    .from(
                        PHOTO_BUCKET
                    )
                    .remove([
                        storagePath
                    ]);


                return res.status(500).json({

                    success: false,

                    error:
                        "Photo metadata could not be saved."
                });
            }


            return res.status(201).json({

                success: true,

                photo:
                    photoRecord,

                storagePath,

                url:
                    signedData.signedUrl
            });

        } catch (error) {

            console.error(
                "POST /api/upload-photo error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Photo upload failed."
            });
        }
    }
);


/* =========================================================
   GET DEVICE GAMES
========================================================= */

app.get(
    "/api/games",
    async (req, res) => {

        try {

            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            const {
                data,
                error
            } =
                await supabase
                    .from("game_sessions")
                    .select("*")
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    )
                    .limit(100);


            if (error) {

                console.error(
                    "Games fetch error:",
                    error
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to load games."
                });
            }


            return res.json({

                success: true,

                games:
                    data || []
            });

        } catch (error) {

            console.error(
                "GET /api/games error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Failed to load games."
            });
        }
    }
);


/* =========================================================
   GET DEVICE PHOTOS
========================================================= */

app.get(
    "/api/photos",
    async (req, res) => {

        try {

            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            const {
                data,
                error
            } =
                await supabase
                    .from("photos")
                    .select("*")
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    )
                    .limit(100);


            if (error) {

                console.error(
                    "Photos fetch error:",
                    error
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to load photos."
                });
            }


            return res.json({

                success: true,

                photos:
                    data || []
            });

        } catch (error) {

            console.error(
                "GET /api/photos error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Failed to load photos."
            });
        }
    }
);


/* =========================================================
   DELETE PHOTO
========================================================= */

app.delete(
    "/api/photos/:id",
    async (req, res) => {

        try {

            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            const photoId =
                cleanString(
                    req.params.id,
                    100
                );


            const {
                data: photo,
                error: findError
            } =
                await supabase
                    .from("photos")
                    .select("*")
                    .eq(
                        "id",
                        photoId
                    )
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .maybeSingle();


            if (findError) {

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to find photo."
                });
            }


            if (!photo) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Photo not found."
                });
            }


            /*
             * Delete from Storage.
             */
            const {
                error: storageError
            } =
                await supabase
                    .storage
                    .from(
                        PHOTO_BUCKET
                    )
                    .remove([
                        photo.storage_path
                    ]);


            if (storageError) {

                console.error(
                    "Storage deletion error:",
                    storageError
                );
            }


            /*
             * Delete metadata.
             */
            const {
                error: deleteError
            } =
                await supabase
                    .from("photos")
                    .delete()
                    .eq(
                        "id",
                        photoId
                    )
                    .eq(
                        "device_id",
                        deviceId
                    );


            if (deleteError) {

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to delete photo metadata."
                });
            }


            return res.json({

                success: true,

                message:
                    "Photo deleted."
            });

        } catch (error) {

            console.error(
                "DELETE photo error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    "Photo deletion failed."
            });
        }
    }
);


/* =========================================================
   ERROR HANDLER FOR MULTER
========================================================= */

app.use(
    (error, req, res, next) => {

        if (
            error instanceof
            multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Photo is too large. Maximum size is 10 MB."
                });
            }


            return res.status(400).json({

                success: false,

                error:
                    error.message
            });
        }


        if (error) {

            console.error(
                "Unhandled error:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message ||
                    "Internal server error."
            });
        }


        next();
    }
);


/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                `Route not found: ${req.method} ${req.originalUrl}`
        });
    }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "🧩 PuzzleMaster Backend"
        );

        console.log(
            "========================================"
        );

        console.log(
            `🚀 Server running on port ${PORT}`
        );

        console.log(
            `🔗 http://localhost:${PORT}`
        );

        console.log(
            `❤️  http://localhost:${PORT}/api/health`
        );

        console.log(
            `📱 POST http://localhost:${PORT}/api/device`
        );

        console.log(
            "========================================"
        );

        console.log("");
    }
);
