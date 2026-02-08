require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors({
  origin: "*"   // or restrict to your extension ID later
}));
app.use(express.json());

// Initialize Supabase
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Track current user_id in memory
let currentUserId = null;

// Track current video instance_id in memory
let currentInstanceId = null;

// Helper function to get current user_id
function getCurrentUserId() {
  return currentUserId;
}

// Helper function to set current user_id
function setCurrentUserId(userId) {
  currentUserId = userId;
  console.log(`Current user_id set to: ${userId}`);
}

// Helper function to get current instance_id
function getCurrentInstanceId() {
  return currentInstanceId;
}

// Helper function to set current instance_id
function setCurrentInstanceId(instanceId) {
  currentInstanceId = instanceId;
  console.log(`Current instance_id set to: ${instanceId}`);
}

// Health check
app.get('/', (req, res) => {
  res.send('Server is alive!');
});

// Create user profile
app.post("/api/create-profile", async (req, res) => {
  try {
    const { email, age, gender, consent_given, condition_details } = req.body;

    // Validate required fields
    if (!email || !age || !gender || consent_given === undefined || condition_details === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, age, gender, consent_given, condition_details'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Validate age - ensure it's a valid integer
    const ageNum = typeof age === 'number' ? Math.floor(age) : parseInt(String(age), 10);
    if (isNaN(ageNum) || ageNum < 1 || ageNum > 150 || !Number.isInteger(ageNum)) {
      return res.status(400).json({
        success: false,
        error: 'Age must be an integer between 1 and 150'
      });
    }

    // Validate consent_given - must be boolean
    if (typeof consent_given !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'consent_given must be a boolean'
      });
    }

    // Check if email already exists
    const { data: existingProfile, error: checkError } = await supabase
      .from("user_info")
      .select("user_id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (checkError) {
      console.error("Error checking for existing profile:", checkError);
      // Continue with insert attempt - let database constraint handle it if it's a duplicate
    }

    if (existingProfile) {
      return res.status(400).json({
        success: false,
        error: 'Email already exists'
      });
    }

    // Insert new profile into Supabase
    const { data, error } = await supabase
      .from("user_info")
      .insert([
        {
          email: email.trim().toLowerCase(),
          age: ageNum,
          gender,
          consent_given,
          condition_details
        }
      ])
      .select("user_id")
      .single();

    if (error) {
      console.error("SUPABASE INSERT ERROR:", error);

      // Handle duplicate email error (in case check above missed it)
      if (error.code === '23505' || error.message.includes('duplicate')) {
        return res.status(400).json({
          success: false,
          error: 'Email already exists'
        });
      }

      return res.status(400).json({
        success: false,
        error: 'Failed to create profile',
        details: error.message
      });
    }

    // FIXED: Check for user_id instead of id
    if (!data || !data.user_id) {
      return res.status(500).json({
        success: false,
        error: 'Profile created but ID not returned'
      });
    }

    setCurrentUserId(data.user_id);

    console.log("Profile created successfully:", data.user_id);
    res.json({
      success: true,
      profileId: data.user_id
    });

  } catch (err) {
    console.error("Error creating profile:", err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err.message
    });
  }
});

// Sign in existing user
app.post("/api/sign-in", async (req, res) => {
  try {
    const { email } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: email'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Check if email exists in database
    const { data: existingProfile, error: checkError } = await supabase
      .from("user_info")
      .select("user_id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (checkError) {
      console.error("Error checking for existing profile:", checkError);
      return res.status(500).json({
        success: false,
        error: 'Database error',
        details: checkError.message
      });
    }

    if (!existingProfile) {
      return res.status(404).json({
        success: false,
        error: 'No account found with this email address'
      });
    }

    setCurrentUserId(existingProfile.user_id);

    console.log("User signed in successfully:", existingProfile.user_id);
    res.json({
      success: true,
      profileId: existingProfile.user_id
    });

  } catch (err) {
    console.error("Error signing in:", err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err.message
    });
  }
});

// Store video data
app.post("/store-video-data", async (req, res) => {
  try {
    const { timestamp_video_started, video_title, video_duration } = req.body;

    // Validate required fields
    if (!timestamp_video_started || !video_title || video_duration === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: timestamp_video_started, video_title, and video_duration'
      });
    }

    const userId = getCurrentUserId();
    
    if (!userId) {
      return res.status(401).json({
        error: 'No user is currently signed in'
      });
    }

    // Insert video data into Supabase
    const { data, error } = await supabase
      .from("video_info")
      .insert([
        {
          user_id: userId,
          timestamp_video_started: timestamp_video_started,
          video_title: video_title,
          video_duration: video_duration
        }
      ])
      .select("instance_id")
      .single();

    if (error) {
      console.error("=== SUPABASE INSERT ERROR - FULL DETAILS ===");
      console.error("Error code:", error.code);
      console.error("Error message:", error.message);
      console.error("Error details:", error.details);
      console.error("Error hint:", error.hint);
      console.error("Full error object:", JSON.stringify(error, null, 2));
      console.error("Data being inserted:", JSON.stringify({
        user_id: userId,
        timestamp_video_started: timestamp_video_started,
        video_title: video_title,
        video_duration: video_duration
      }, null, 2));
      console.error("===========================================");
      return res.status(400).json({
        error: 'Failed to insert video data',
        details: error.message,
        code: error.code,
        hint: error.hint,
        supabaseError: error
      });
    }

    if (!data || !data.instance_id) {
      return res.status(500).json({
        error: 'Video data created but instance_id not returned'
      });
    }

    // Set the current instance_id for future updates
    setCurrentInstanceId(data.instance_id);

    console.log("Video data inserted successfully:", data.instance_id);
    res.json({
      success: true,
      instanceId: data.instance_id
    });

  } catch (err) {
    console.error("Error storing video data:", err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

// Store quiz responses
app.post("/store", async (req, res) => {
  try {
    const { 
      videoId, 
      question, 
      result, 
      mcq_options, 
      ans_selected, 
      correct_ans, 
      ans_explain, 
      timestamp_question_generated, 
      question_skipped 
    } = req.body;

    if (!videoId || question === undefined || result === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: videoId, question, and result'
      });
    }

    const userId = getCurrentUserId();
    
    if (!userId) {
      return res.status(401).json({
        error: 'No user is currently signed in'
      });
    }

    const { error } = await supabase
      .from("user_response")
      .insert([
        {
          user_id: userId,
          video_id: videoId,
          question: question,
          result: result,
          mcq_options: mcq_options,
          ans_selected: ans_selected,
          correct_ans: correct_ans,
          ans_explain: ans_explain,
          timestamp_question_generated: timestamp_question_generated,
          question_skipped: question_skipped
        }
      ]);

    if (error) {
      console.error("SUPABASE INSERT ERROR:", error);
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error storing quiz response:", err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

// Generate content with OpenAI
app.post("/api/generate", async (req, res) => {
  const prompt = req.body.prompt;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `OpenAI API responded with status: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("OpenAI API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Predict emotions (proxies to emotion API with hidden key)
app.post("/api/predict-emotions", async (req, res) => {
  try {
    const { sentences } = req.body;

    if (!sentences || !Array.isArray(sentences)) {
      return res.status(400).json({
        error: 'Missing or invalid sentences array'
      });
    }

    const API_URL = "https://my-model-api-908275317484.us-central1.run.app";
    const API_KEY = process.env.EMOTION_API_KEY;

    if (!API_KEY) {
      console.error("EMOTION_API_KEY not set in environment variables");
      return res.status(500).json({
        error: 'Server configuration error'
      });
    }

    const response = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY
      },
      body: JSON.stringify({
        text: sentences
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Emotion API responded with status: ${response.status} - ${errorText}`);
    }

    const data = await response.json().catch(() => {
      throw new Error('Invalid JSON response from emotion API');
    });
    res.json(data);

  } catch (error) {
    console.error("Emotion API Error:", error);
    res.status(500).json({
      error: 'Failed to predict emotions',
      details: error.message
    });
  }
});

// Store emotion prediction data
app.post("/store-emotions", async (req, res) => {
  try {
    const { video_id, raw_response} = req.body;

    // Validate required fields
    if (!video_id || raw_response === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: video_id and raw_response'
      });
    }

    const userId = getCurrentUserId();
    
    if (!userId) {
      return res.status(401).json({
        error: 'No user is currently signed in'
      });
    }

    const instanceId = getCurrentInstanceId();

    if (!instanceId) {
      return res.status(400).json({
        error: 'No video instance found. Please call /store-video-data first.'
      });
    }

    // Check if emotion data has already been stored for this instance
    const { data: existingData, error: checkError } = await supabase
      .from("video_info")
      .select("video_id, top_emotions")
      .eq('instance_id', instanceId)
      .eq('user_id', userId)
      .single();

    if (checkError) {
      console.error("Error checking existing emotion data:", checkError);
      return res.status(400).json({
        error: 'Failed to check existing data',
        details: checkError.message
      });
    }

    if (existingData && existingData.video_id) {
      console.log("Emotion data already stored for instance:", instanceId);
      return res.json({
        success: true,
        message: 'Emotion data already exists for this video instance',
        alreadyStored: true,
        data: existingData
      });
    }

    // raw_response should be a stringified JSON array for the top_emotions column
    // Ensure it's a string (in case it comes as an object, stringify it)
    const top_emotions_string = typeof raw_response === 'string'
      ? raw_response
      : JSON.stringify(raw_response);

    const { data, error } = await supabase
      .from("video_info")
      .update({
        video_id: video_id,
        top_emotions: top_emotions_string
      })
      .eq('instance_id', instanceId)
      .eq('user_id', userId)
      .select();

    if (error) {
      console.error("SUPABASE UPDATE ERROR:", error);
      return res.status(400).json({
        error: 'Failed to update emotion data',
        details: error.message
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        error: 'Video instance not found or does not belong to current user'
      });
    }

    console.log("Emotion data updated successfully:", data);
    res.json({
      success: true,
      message: 'Emotion data stored successfully',
      data: data
    });

  } catch (err) {
    console.error("Error storing emotion data:", err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
