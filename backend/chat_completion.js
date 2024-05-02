// const OpenAI = require('openai');
// require('dotenv').config();
// // require('OpenAI');
// // import OpenAI from "openai";
// const openai = new OpenAI();

// async function getCompletion() {
//     const completion = await openai.chat.completions.create({
//         messages: [{"role": "system", "content": "You are a helpful assistant."},
//             {"role": "user", "content": "Who won the world series in 2020?"},
//             {"role": "assistant", "content": "The Los Angeles Dodgers won the World Series in 2020."},
//             {"role": "user", "content": "Where was it played?"}],
//         model: "gpt-3.5-turbo",
//       });
//     return completion.choices[0].text;
// }

// module.exports = getCompletion;

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Access your API key as an environment variable (see "Set up your API key" above)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function getCompletion() {
  // For text-only input, use the gemini-pro model
  const model = genAI.getGenerativeModel({ model: "gemini-pro"});

  const prompt = "Write a story about a magic backpack."

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();
  console.log(text);
  return text;
}

module.exports = getCompletion;