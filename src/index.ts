import "dotenv/config";
import express from "express";
const app = express();
import router from "./router"
import cors from "cors";

app.use(cors());

app.use(express.json());

app.use("/api", router);

const port = process.env.PORT;

app.listen(port,()=>{
  console.log(`running on port ${port}`);
});
