const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const { Server: SocketIOServer } = require('socket.io');
const { Agent, run, user, tool } = require('@openai/agents');
const OpenAI = require('openai');
const { z } = require('zod');
const path = require('path');

require('dotenv').config();
const { OPENAI_API_KEY } = process.env;
const whitelist = process.env.CLIENT_WHITELIST?.split(',') || [];
const nodeENV = process.env.NODE_ENV || 'development';
// Start the server
const PORT = process.env.PORT || 3000;

console.log({ client: process.env.CLIENT_WHITELIST });
// Setup Express
const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  // optional settings
  cors: {
    origin:
      nodeENV === 'development'
        ? '*'
        : function (origin, callback) {
            console.log({ origin, whitelist });
            if (whitelist.indexOf(origin) !== -1) {
              callback(null, true);
            } else {
              callback(new Error('Not allowed by CORS'));
            }
          },
  },
});

// Set up OpenAI Client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const ttsModelInstruction = `
# Personality and Tone
## Identity
Speask politely and vividly, but without any spices in emotions, in general act as helpful assistant.

## Task
Your task is to gather information about real-estate search criterias, form a search URL and return it to user. If user asks questions not related to real-estate search,
please say that you can't answer the quesiton, you can only gather information about RE.

## Demeanor
patient and serious

## Tone
polite and authoritative but at the same time vivid and at a medium pace 

## Level of Enthusiasm
60% calm and measured and 40% enthusiastic

## Level of Formality
professional language, for example: “Good afternoon, how may I assist you?”

## Level of Emotion
A little bit emoutional, act as customer support agent, which is here to help client but rather formal

## Filler Words
Do not include filter words like “um,” “uh,” "hm," etc...

## Pacing
Fast
`;

const supportAgentInstruction = `
## Other details
Please provide your responce in form of spoken text, since it will be sounded out after. The output text should be easy to pronounce.
Do not use numbers and use punctuation signs to form gramaticaly correct sentences.

# Instructions
- If user asks questions not related to real-estate search, please say that you can't answer the quesiton, you can only gather information about RE.
- Ask user about parameters to form a search url, parameters are:
    1.\`bathrooms\` -  required, count of bathrooms, possible values are \`all or from 1 to 6\`, try to fit value given by user into one the given values, if you can't set value to 'all'
    2. \`bedrooms\` - required, count of bedrooms, possible values are \`all or from 1 to 6\`, try to fit value given by user into one the given values, if you can't set value to 'all'
    3. priceMin - required, minimal price, any number (minimal and default is 1500 US dollars), try to fit value given by user into one the given values, if you can't set value to 1500
    4. priceMax  - required, maximal price, any number (max and default is 1500000 US dollars, try to fit value given by user into one the given values, if you can't set value to 1500000
    5. parkingSpacesMin  - required, minimal amount of parking spaces , any number (default 0) , try to fit value given by user into one the given values, if you can't set value to 0. If user says he doesn't want a RE estate to have parking spaces - set to 0.
    6. parkingSpacesMax - required, maximal amount of parking spaces, any number (default 6), try to fit value given by user into one the given values, if you can't set value to 6
    7. keywords - optional, array of strings, try to make keywords from the leaving information methioned by user (e.g. "I want an appartment with swimming pool and tent - keywords:["pool", "tent", "apprtment"]
- Please, check values user provides with constraints for each parameter provided above.
- If user says he/she doesn't need parking spaces, set both minimum and maximum to 0.
- If user didn't mention all the required parameters, reask him/her to mention required ones left.
- Your responces should be generated ONLY in English.
- Please use plain text as response format (not markdown, not html, not anything else).
- If user mentioned ALL the parameters during conversation: call tool generate_re_search_url with all parameters and notify client that link to search results will appear below.

`;
// Assistant can be created via API or UI

// ========================
// OpenAI assistant section
// ========================

/**
 * Stores active voice streaming file names.
 */
const activeStreamsMap = new Map();

/**
 * Stores chat history for each socket.
 */
const chatHistoryMap = new Map();

const VOICE_FILES_DIR = './voiceFiles';
const VOICE_FILE_EXTENTION = 'webm';

function voiceFilePath(fileName) {
  return `${VOICE_FILES_DIR}/${fileName}.${VOICE_FILE_EXTENTION}`;
}

if (!fs.existsSync(VOICE_FILES_DIR)) {
  fs.mkdirSync(VOICE_FILES_DIR);
}

function getStreamByFilename(fileName) {
  if (!fileName) throw new Error(`Error: filename is not provided`);

  const stream = activeStreamsMap.get(fileName);

  if (!stream)
    throw new Error('Error: stream is not initialized by this filename');

  return stream;
}

io.on('connection', (socket) => {
  const generateRESearchUrl = tool({
    name: 'generate_re_search_url',
    // The description is used to describe **when** to use the tool by telling it **what** it does.
    description:
      'Receives real state search parameters and formulates search url. User this tool when ALL required values are defined.',
    // This tool takes no parameters, so we provide an empty Zod Object.
    parameters: z.object({
      bathrooms: z
        .string({
          description:
            'Count of bathrooms. Possible values: all, 1, 2, 3, 4, 5, or 6. Defaults to all if parsing fails.',
        })
        .default('all'),
      bedrooms: z
        .string({
          description:
            'Count of bedrooms. Possible values: all, 1, 2, 3, 4, 5, or 6. Defaults to all if parsing fails.',
        })
        .default('all'),
      priceMin: z
        .number({
          description:
            'Minimal price. Any number. Defaults to 1500 if parsing fails or not provided.',
        })
        .default(1500),
      priceMax: z
        .number({
          description:
            'Maximal price. Any number. Defaults to 1500000 if parsing fails or not provided.',
        })
        .default(1500000),
      parkingSpacesMin: z
        .number({
          description:
            'Minimal number of parking spaces. Any number >= 0. Defaults to 0 if parsing fails or not provided.',
        })
        .default(0),
      parkingSpacesMax: z
        .number({
          description:
            'Maximal number of parking spaces. Any number <= 6. Defaults to 6 if parsing fails or not provided.',
        })
        .default(6),
      keywords: z
        .array(z.string(), {
          description:
            'Optional array of keywords extracted from user request, e.g., ["pool", "tent", "apartment"].',
        })
        .nullable(),
    }),
    execute: async (body) => {
      try {
        const BASE_URL = process.env.SEARCH_URL_BASE_URL;
        const url = new URL(BASE_URL);

        Object.keys(body).forEach((key) => {
          const value = body[key];
          const isDefined = !(typeof value === 'undefined' || value === null);
          if (isDefined) {
            url.searchParams.append(key, String(value));
          }
        });

        url.searchParams.append('slug', 'jeff-cook-app');
        url.searchParams.append(
          'polygon',
          '34.455113,-81.918993,33.642698,-81.92174%2C33.658703,-80.238085%2C34.473229,-80.257311'
        );
        url.searchParams.append(
          'bounds',
          '33.22357,-82.943079,34.936427,-79.23794'
        );

        const stringURL = url.toString();

        console.log({ stringURL });

        socket.emit('receive-search-url', stringURL);
        // call socket event here
        return 'Sharks are older than trees.';
      } catch {
        return 'Failed to create search url, please ask client to try again.';
      }
    },
  });

  const supportAgent = new Agent({
    name: 'Support Agent',
    instructions: supportAgentInstruction,
    tools: [generateRESearchUrl],
  });

  console.log('Client connected:', socket.id);

  socket.on('get-transacription', async (body, callback) => {
    // {fileName: string}
    try {
      const { fileName } = body;
      console.log('[LOG] get-transacription called');

      if (!fileName) throw new Error(`Error: filename is not provided`);

      const filePath = voiceFilePath(fileName);
      console.log(`Transcribing file ${filePath}`);

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        language: 'en',
        model: 'gpt-4o-transcribe',
      }); // { text: string }
      // console.log(
      //   `Transcription finished: ${transcription?.text || 'no text'}`
      // );

      callback({
        status: 'success',
        data: transcription,
      });
    } catch (error) {
      console.log(error);
      const message = error.message || 'Error transcribing voice file.';
      callback({
        status: 'error',
        errorMessage: message,
      });
      // return message that an error occured while trinscribtion
    }
  });

  /**
   * Creates new file write stream and returns it back.
   * @returns - object with status and data (on failure with errorMessage set to error)
   */
  socket.on('voice-file-stream:init', (callback) => {
    console.log('[LOG] voice-file-stream:init called');
    const ipAddress = socket.handshake.address;
    console.log({ ipAddress });
    try {
      const fileName = `${socket.id}-${Date.now()}`;
      const filePath = `${VOICE_FILES_DIR}/${fileName}.${VOICE_FILE_EXTENTION}`;
      const writeStream = fs.createWriteStream(filePath);
      activeStreamsMap.set(fileName, writeStream);
      callback({
        status: 'success',
        data: {
          fileName,
        },
      });
    } catch (error) {
      console.log(error);
      const message = error.message || 'Error while initializing voice stream.';
      callback({
        status: 'error',
        errorMessage: message,
      });
    }
  });

  /**
   * Receives chunk of voice and writes it to file.
   * @param body - contains filename(streamid) and chunk itself
   * @returns - object with status and data (on failure with errorMessage set to error)
   */
  socket.on('voice-file-stream:chunk', (body, callback) => {
    console.log('[LOG] voice-file-stream:chunk called');
    try {
      // console.log({ body });
      const { fileName, chunk } = body;

      const stream = getStreamByFilename(fileName);

      if (!stream.closed) {
        stream.write(chunk, (error) => {
          if (error) {
            throw new Error(
              `Error[voice-file-stream:init]: While writting chunk\n${error}`
            );
          }
        });
      }
      callback({
        status: 'success',
      });
    } catch (error) {
      console.log(error);
      const message =
        error.message || 'Error while writting voice chunk to file.';
      callback({
        status: 'error',
        errorMessage: message,
      });
    }
  });

  /**
   * Cancels voice file streaming with closing stream and deleting file.
   * @param body - contains filename(streamid)
   * @returns - object with status and data (on failure with errorMessage set to error)
   */
  socket.on('voice-file-stream:cancel', (body, callback) => {
    console.log('[LOG] voice-file-stream:cancel called');
    try {
      // console.log({ body });
      const { fileName } = body;

      const stream = getStreamByFilename(fileName);

      if (!stream.closed) {
        stream.end();
      }

      const filePath = voiceFilePath(fileName);
      fs.unlinkSync(filePath);

      fs.callback({
        status: 'success',
      });
    } catch (error) {
      console.log(error);
      const message =
        error.message || 'Error while writting voice chunk to file.';
      callback({
        status: 'error',
        errorMessage: message,
      });
    }
  });

  /**
   * Stop stream and remove it form active streams.
   * @param body - contains filename(streamid)
   * @returns - object with status and data (on failure with errorMessage set to error)
   */
  socket.on('voice-file-stream:destroy', (body, callback) => {
    console.log('[LOG] voice-file-stream:destory called');
    try {
      // console.log({ body });
      const { fileName } = body;
      const stream = getStreamByFilename(fileName);

      stream.end();
      callback({
        status: 'success',
      });
    } catch (error) {
      console.log(error);
      const message = error.message || 'Error while closing voice stream.';
      callback({
        status: 'error',
        errorMessage: message,
      });
    }
  });

  /**
   * ADMIN ONLY - removes all voice files from folder
   * @param body - contains prompt in form of text and configuration
   * @returns - object with status and data (on failure with errorMessage set to error)
   */
  socket.on('voice-file-stream:remove-all', async (body, callback) => {
    console.log('[LOG] voice-file-stream:remove-all called');
    try {
      console.log({ body });
      const json = typeof body === 'string' ? JSON.parse(body) : body;
      const { authToken } = json;
      if (!authToken || authToken !== process.env.ADMIN_TOKEN) {
        throw new Error(
          'Unathorized: Please provide valid auth token in body to perform this action.'
        );
      }
      fs.readdir(VOICE_FILES_DIR, (err, files) => {
        if (err) {
          console.error('Error reading directory:', err);
          return;
        }

        for (const file of files) {
          const filePath = path.join(VOICE_FILES_DIR, file);
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`Error deleting file ${filePath}:`, unlinkErr);
            } else {
              console.log(`Deleted: ${filePath}`);
            }
          });
        }
      });
      callback({ status: 'success' });
    } catch (error) {
      console.log(error);
      const message = error.message || 'Error while closing voice stream.';
      callback({
        status: 'error',
        errorMessage: message,
      });
    }
  });
  // Agent events
  /**
   * Receives a prompt from user answer in given formats.
   * @param body - contains prompt in form of text and configuration
   * @returns - object with status and data (on failure with errorMessage set to error)
   */
  socket.on('agent-answer', async (body, callback) => {
    console.log('[LOG] voice-file-stream:destory called');
    try {
      const { prompt, streamVoice } = body; // prompt: string, streamVoice = boolean
      const history = chatHistoryMap.get(socket.id) || [];

      history.push(user(prompt));
      chatHistoryMap.set(socket.id, history);

      const result = await run(supportAgent, history);

      const answer = result.finalOutput;

      callback({ status: 'success', data: { text: answer } });

      socket.emit('setup-final-search-url'); // calling this here to ensure url is setup only after actual agent response

      if (streamVoice) {
        const ttsConfig = (inputText) => ({
          model: 'gpt-4o-mini-tts',
          voice: 'coral',
          input: inputText,
          instructions: ttsModelInstruction,
          response_format: 'mp3',
        });

        const response = await openai.audio.speech.create(ttsConfig(answer));

        for await (const chunk of response.body) {
          socket.emit('agent-response:audio-chunk', chunk);
        }

        socket.emit('agent-response:audio-end');
      }
      callback({ status: 'success' });
    } catch (error) {
      console.log(error);
      const message = error.message || 'Error while closing voice stream.';
      callback({
        status: 'error',
        errorMessage: message,
      });
    }
  });

  // TTS events

  // Shared

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
