const express = require('express');
const cors = require('cors');

require('dotenv').config();
const OpenAI = require('openai');
const { OPENAI_API_KEY } = process.env;

// Setup Express
const app = express();
app.use(express.json());
app.use(cors()); // allow CORS for all origins

// Set up OpenAI Client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Assistant can be created via API or UI

// ========================
// OpenAI assistant section
// ========================

const assistantInstruction = `
    You a support aget in real estate company. If user wants to search for real estate, please ask user to name such search criterias: count of bathrooms, count of bedrooms, minimal price, maximal price, minimal amount of parking spaces, maximal amount of parking spaces.
If the client has mentioned all the data described above - RESPOND EXACTLY: "Thanks! Now i will search for all relevant real estate for you. [URL](constructed_url)". Here construct a url(constructed_url) with base http://127.0.0.1:5500/frontend/index.html and such seach params. 
Constructed url inlude into text as - use EXACTLY this format, just replace constructed_url with actuall URL with search paramenters.
1.\`bathrooms\` -  count of bathrooms, possible values are \`all, 1, 2, 3, 4, 5, 6\`, try to fit value given by user into one the given values, if you can't set value to 'all'
2. \`bedrooms\` - count of bedrooms, possible values are \`all, 1, 2, 3, 4, 5, 6\`, try to fit value given by user into one the given values, if you can't set value to 'all'
3. priceMin - minimal price, any number (minimal and default is 1500), try to fit value given by user into one the given values, if you can't set value to 1500
4. priceMax  - maximal price, any number (max and default is 1500000, try to fit value given by user into one the given values, if you can't set value to 1500000
5. parkingSpacesMin  - minimal amount of parking spaces , any number (default 0) , try to fit value given by user into one the given values, if you can't set value to 0
6. parkingSpacesMax - maximal amount of parking spaces, any number (default 6), try to fit value given by user into one the given values, if you can't set value to 6
7. keywords - array of strings, try to make keywords from the leaving information methioned by user (e.g. "I want an appartment with swimming pool and tent - keywords:["pool", "tent", "apprtment"]

all the parameters are optional, include them to url ONLY THEN user explicitly mentioned them
`;

app.post('/message', async (req, res) => {
  const { message, threadId, prevResponseId } = req.body;
  console.log(`[${prevResponseId}] Got message ${message}. Processing...`);
  const response = await openai.responses.create({
    model: 'o4-mini',
    stream: false,
    instructions: assistantInstruction,
    reasoning: { effort: 'medium' },
    previous_response_id: prevResponseId,
    input: message,
  });
  const result = {
    message: response?.output_text,
    responseId: response?.id,
  };
  res.status(200).json(result);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
