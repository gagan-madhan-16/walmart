import { Router } from "express";
const router = Router();

import gemini from "./gemini";
router.use("/gemini", gemini);

export default router;
