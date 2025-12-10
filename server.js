require("dotenv").config();
console.log("Loaded API key:", process.env.OPENAI_API_KEY);

const express = require("express");
const fetch = require("node-fetch");
const app = express();
const cors = require("cors");
app.use(cors({
  origin: "*"   // or restrict to your extension ID later
}));


app.use(express.json());

app.post("/api/generate", async (req, res) => {
  const prompt = req.body.prompt;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  res.json(data);
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
