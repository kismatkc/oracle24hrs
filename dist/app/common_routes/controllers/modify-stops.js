import express from "express";
import { Redis } from "../../../lib/reddis.js";
const router = express.Router();
async function modifyStops(req, res) {
    try {
        const stops = req.body.stops;
        const response = await Redis.set("stops", stops);
        res.status(200).json({
            success: true,
        });
    }
    catch (error) {
        res.status(200).json({
            success: false,
        });
    }
}
router.post("/modify-stops", modifyStops);
export default router;
