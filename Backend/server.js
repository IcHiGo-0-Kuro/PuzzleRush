"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");

const { createClient } = require("@supabase/supabase-js");


/* =========================================================
   CONFIGURATION
========================================================= */

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const NODE_ENV =
    process.env.NODE_ENV || "development";

const IS_PRODUCTION =
    NODE_ENV === "production";


/* =========================================================
   VALIDATE ENVIRONMENT
========================================================= */

if (!SUPABASE_URL) {
    console.error(
        "❌ Missing SUPABASE_URL environment variable."
    );

    process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
        "❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable."
    );

    process.exit(1);
}


/* =========================================================
   SUPABASE
========================================================= */

const supabase = createClient(
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

const app = express();


/*
 * Render runs behind a reverse proxy.
 *
 * This allows Express to correctly understand
 * forwarded HTTPS requests and client IP addresses.
 */
app.set("trust proxy", 1);


/* =========================================================
   CORS
========================================================= */

/*
 * Allowed frontend origins:
 *
 * Local:
 * - http://localhost:5173
 * - http://localhost:3000
 *
 * Vercel:
 * - https://anything.vercel.app
 *
 * You can also add your custom production domain below
 * if you have one.
 */

const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000"
];


function isAllowedOrigin(origin) {

    /*
     * Some requests, such as server-to-server requests,
     * may not contain an Origin header.
     */
    if (!origin) {
        return true;
    }


    /*
     * Exact local origins.
     */
    if (allowedOrigins.includes(origin)) {
        return true;
    }


    /*
     * Allow Vercel deployment URLs.
     *
     * Example:
     * https://puzzlemaster.vercel.app
     */
    try {

        const url = new URL(origin);

        if (
            url.protocol === "https:" &&
            (
                url.hostname === "vercel.app" ||
                url.hostname.endsWith(".vercel.app")
            )
        ) {
            return true;
        }

    } catch (error) {

        return false;
    }


    /*
     * If you have a custom frontend domain,
     * add it here.
     *
     * Example:
     *
     * if (origin === "https://www.example.com") {
     *     return true;
     * }
     */

    return false;
}


app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "http://localhost:3000",
            "https://ichigo-0-kuro.github.io" // 👈 Make sure your full username is here!
        ],

        credentials: true,

        methods: [
            "GET",
            "POST",
            "PATCH",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
    })
);




/* =========================================================
   BODY PARSING
========================================================= */

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
========================================================= */

/*
 * Uploaded images are kept temporarily in memory.
 *
 * They are immediately uploaded to Supabase Storage.
 */

const upload = multer({

    storage: multer.memoryStorage(),

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {

        if (
            file.mimetype &&
            file.mimetype.startsWith("image/")
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

const PHOTO_BUCKET = "puzzle-images"; // 👈 Must match Supabase exactly



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
 * UUID validation.
 */
function isValidUUID(value) {

    if (
        typeof value !== "string"
    ) {
        return false;
    }

    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    return uuidPattern.test(value);
}


/*
 * Generate a random storage filename.
 */
function generateStorageName(originalName) {

    const extension =
        path.extname(
            originalName || ""
        ).toLowerCase() || ".jpg";

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
 * Get client IP.
 */
function getClientIp(req) {

    const forwardedFor =
        req.headers["x-forwarded-for"];

    if (forwardedFor) {

        return forwardedFor
            .split(",")[0]
            .trim();
    }

    return (
        req.socket.remoteAddress ||
        null
    );
}


/*
 * Get or create device ID.
 *
 * Priority:
 *
 * 1. Existing cookie
 * 2. Request body deviceId
 * 3. New UUID
 */
function getOrCreateDeviceId(
    req,
    res
) {

    let deviceId =
        cleanString(
            req.cookies?.[DEVICE_COOKIE],
            100
        );


    /*
     * Only use body deviceId if no cookie exists.
     */
    if (!deviceId) {

        deviceId =
            cleanString(
                req.body?.deviceId,
                100
            );
    }


    /*
     * If invalid, create a new UUID.
     */
    if (
        !isValidUUID(deviceId)
    ) {

        deviceId =
            generateDeviceId();
    }


    /*
     * IMPORTANT:
     *
     * Vercel frontend + Render backend are cross-site.
     *
     * Therefore production cookies use:
     *
     * SameSite=None
     * Secure=true
     *
     * Local development uses Lax.
     */
    res.cookie(
        DEVICE_COOKIE,
        deviceId,
        {
            httpOnly: true,

            sameSite:
                IS_PRODUCTION
                    ? "none"
                    : "lax",

            secure:
                IS_PRODUCTION,

            maxAge:
                1000 *
                60 *
                60 *
                24 *
                365 *
                5,

            path: "/"
        }
    );


    return deviceId;
}


/*
 * Verify that a device exists.
 */
async function deviceExists(
    deviceId
) {

    const {
        data,
        error
    } = await supabase
        .from("devices")
        .select("device_id")
        .eq(
            "device_id",
            deviceId
        )
        .maybeSingle();

    if (error) {

        throw error;
    }

    return Boolean(data);
}


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        return res.json({

            success: true,

            message:
                "PuzzleMaster backend is running.",

            environment:
                NODE_ENV,

            timestamp:
                new Date().toISOString()
        });
    }
);


/* =========================================================
   DEVICE INITIALIZATION
========================================================= */

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

                    device:
                        existingDevice
                });
            }


            /*
             * New device.
             */
            const ipAddress =
                getClientIp(req);

            const userAgent =
                cleanString(
                    req.headers["user-agent"],
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

                device:
                    newDevice
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
   GET DEVICE
========================================================= */

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


            /*
             * Existing device.
             */
            if (data) {

                return res.json({

                    success: true,

                    existing: true,

                    device: data
                });
            }


            /*
             * Create device if it does not exist.
             */
            const ipAddress =
                getClientIp(req);

            const userAgent =
                cleanString(
                    req.headers["user-agent"],
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

                device:
                    newDevice
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
                !Number.isInteger(maxMoves) ||
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
            const exists =
                await deviceExists(
                    deviceId
                );


            if (!exists) {

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


            /*
             * Identify current device.
             */
            const deviceId =
                getOrCreateDeviceId(
                    req,
                    res
                );


            /*
             * Verify the game belongs to this device.
             *
             * This prevents one device from updating
             * another device's game if the game ID is known.
             */
            const {
                data: existingGame,
                error: findGameError
            } =
                await supabase
                    .from("game_sessions")
                    .select("*")
                    .eq(
                        "id",
                        gameId
                    )
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .maybeSingle();


            if (findGameError) {

                console.error(
                    "Game ownership lookup error:",
                    findGameError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to verify game."
                });
            }


            if (!existingGame) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Game not found for this device."
                });
            }


            const updates = {};


            /* -----------------------------------------
               MOVES
            ----------------------------------------- */

            if (
                req.body.moves !== undefined
            ) {

                const moves =
                    Number(
                        req.body.moves
                    );

                if (
                    !Number.isInteger(moves) ||
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


            /* -----------------------------------------
               MAX MOVES
            ----------------------------------------- */

            if (
                req.body.maxMoves !== undefined
            ) {

                const maxMoves =
                    Number(
                        req.body.maxMoves
                    );

                if (
                    !Number.isInteger(maxMoves) ||
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


            /* -----------------------------------------
               TIME
            ----------------------------------------- */

            if (
                req.body.time !== undefined
            ) {

                const time =
                    Number(
                        req.body.time
                    );

                if (
                    !Number.isFinite(time) ||
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


            /* -----------------------------------------
               SCORE
            ----------------------------------------- */

            if (
                req.body.score !== undefined
            ) {

                const score =
                    Number(
                        req.body.score
                    );

                if (
                    !Number.isFinite(score)
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


            /* -----------------------------------------
               STATUS
            ----------------------------------------- */

            if (
                req.body.status !== undefined
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


            /* -----------------------------------------
               MOVES USED
            ----------------------------------------- */

            if (
                req.body.movesUsed !== undefined
            ) {

                const movesUsed =
                    Number(
                        req.body.movesUsed
                    );

                if (
                    !Number.isInteger(movesUsed) ||
                    movesUsed < 0
                ) {

                    return res.status(400).json({

                        success: false,

                        error:
                            "Invalid movesUsed value."
                    });
                }

                updates.moves =
                    movesUsed;
            }


            /* -----------------------------------------
               COMPLETED
            ----------------------------------------- */

            if (
                req.body.completed === true
            ) {

                updates.status =
                    "won";

                updates.completed_at =
                    new Date().toISOString();
            }


            /* -----------------------------------------
               FAILED
            ----------------------------------------- */

            if (
                req.body.failed === true
            ) {

                updates.status =
                    "lost";

                updates.completed_at =
                    new Date().toISOString();
            }


            /* -----------------------------------------
               NOTHING TO UPDATE
            ----------------------------------------- */

            if (
                Object.keys(updates).length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "No updates supplied."
                });
            }


            /* -----------------------------------------
               UPDATE
            ----------------------------------------- */

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
                    .eq(
                        "device_id",
                        deviceId
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

/*
 * Main upload endpoint:
 *
 * POST /api/upload-photo
 *
 * Frontend alias:
 *
 * POST /api/upload
 *
 * Both are supported.
 */

async function handlePhotoUpload(
    req,
    res
) {

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
         * If gameId was supplied, make sure it belongs
         * to the current device.
         */
        if (gameId) {

            const {
                data: game,
                error: gameError
            } =
                await supabase
                    .from("game_sessions")
                    .select("id")
                    .eq(
                        "id",
                        gameId
                    )
                    .eq(
                        "device_id",
                        deviceId
                    )
                    .maybeSingle();


            if (gameError) {

                console.error(
                    "Upload game verification error:",
                    gameError
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Failed to verify game."
                });
            }


            if (!game) {

                return res.status(404).json({

                    success: false,

                    error:
                        "Game not found for this device."
                });
            }
        }


        /*
         * Generate unique storage filename.
         */
        const filename =
            generateStorageName(
                req.file.originalname
            );


        const storagePath =
            `${deviceId}/${filename}`;


        /* -----------------------------------------
           UPLOAD TO SUPABASE STORAGE
        ----------------------------------------- */

        const {
            error: uploadError
        } =
            await supabase
                .storage
                .from(PHOTO_BUCKET)
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


        /* -----------------------------------------
           CREATE SIGNED URL
        ----------------------------------------- */

        const {
            data: signedData,
            error: signedError
        } =
            await supabase
                .storage
                .from(PHOTO_BUCKET)
                .createSignedUrl(
                    storagePath,
                    60 * 60 * 24
                );


        if (signedError) {

            console.error(
                "Signed URL error:",
                signedError
            );


            /*
             * Clean up uploaded file.
             */
            await supabase
                .storage
                .from(PHOTO_BUCKET)
                .remove([
                    storagePath
                ]);


            return res.status(500).json({

                success: false,

                error:
                    "Photo uploaded, but URL generation failed."
            });
        }


        /* -----------------------------------------
           STORE PHOTO METADATA
        ----------------------------------------- */

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
                        playerName || null,

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
             * Remove uploaded file if database
             * insertion fails.
             */
            await supabase
                .storage
                .from(PHOTO_BUCKET)
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
            "POST photo upload error:",
            error
        );

        return res.status(500).json({

            success: false,

            error:
                "Photo upload failed."
        });
    }
}


/*
 * Original endpoint.
 */
app.post(
    "/api/upload-photo",
    upload.single("photo"),
    handlePhotoUpload
);


/*
 * Frontend-friendly alias.
 */
app.post(
    "/api/upload",
    upload.single("photo"),
    handlePhotoUpload
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


            if (!photoId) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Photo ID is required."
                });
            }


            /*
             * Only find photos belonging to this device.
             */
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

                console.error(
                    "Photo lookup error:",
                    findError
                );

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


            /* -----------------------------------------
               DELETE FROM STORAGE
            ----------------------------------------- */

            const {
                error: storageError
            } =
                await supabase
                    .storage
                    .from(PHOTO_BUCKET)
                    .remove([
                        photo.storage_path
                    ]);


            if (storageError) {

                console.error(
                    "Storage deletion error:",
                    storageError
                );

                /*
                 * We continue because metadata can
                 * still be removed.
                 */
            }


            /* -----------------------------------------
               DELETE DATABASE RECORD
            ----------------------------------------- */

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

                console.error(
                    "Photo metadata deletion error:",
                    deleteError
                );

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
   MULTER / GLOBAL ERROR HANDLER
========================================================= */

app.use(
    (error, req, res, next) => {

        /*
         * CORS errors.
         */
        if (
            error &&
            error.message ===
                "Not allowed by CORS."
        ) {

            return res.status(403).json({

                success: false,

                error:
                    "Origin is not allowed."
            });
        }


        /*
         * Multer errors.
         */
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


        /*
         * Other errors.
         */
        if (error) {

            console.error(
                "Unhandled server error:",
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

        return res.status(404).json({

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
            `🌎 Environment: ${NODE_ENV}`
        );

        console.log(
            `❤️  Health: /api/health`
        );

        console.log(
            `📱 Device: POST /api/device`
        );

        console.log(
            `🎮 Game: POST /api/game`
        );

        console.log(
            `📸 Upload: POST /api/upload`
        );

        console.log(
            `📸 Upload: POST /api/upload-photo`
        );

        console.log(
            "========================================"
        );

        console.log("");
    }
);
