const express = require("express");
const app = express();
const cors = require("cors");

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.post("/api/add-to-cart", (req, res) => {
console.log("hello ashish",req.body)
return res.json({
    message:"hello ashish"
})
});           

app.listen(4000, () => {
  console.log("Server is running on port 4000");
});

