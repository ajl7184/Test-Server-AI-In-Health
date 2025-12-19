require("dotenv").config();
console.log("Loaded API key:", process.env.OPENAI_API_KEY);
const{ createClient} = require("@supabase/supabase-js");
const express = require("express");
const fetch = require("node-fetch");
const app = express();
const cors = require("cors");
app.use(cors({
  origin: "*"   // or restrict to your extension ID later
}));


app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.get('/', (req, res) => {
  res.send('Server is alive!');
});

app.post("/store", async (req, res) => {
  const { videoId, question, result } = req.body;

  //supabase insert
  const { error } = await supabase
    .from("responses")
    .insert([
      {
        video_id: videoId,
        question_text: question,
        is_correct: result
      }
    ]);

  if (error) {
  console.error("SUPABASE INSERT ERROR:", error);
  return res.status(400).json({ error });
}

  res.json({ success: true });
});

app.post("/api/generate", async (req, res) => {
  const prompt = req.body.prompt;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
