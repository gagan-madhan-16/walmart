import { Router } from "express";
const router = Router();

import gemini from "./gemini";
router.use("/gemini", gemini);

import reviews from "./reviews";
router.use("/reviews", reviews);

export default router;
