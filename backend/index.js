const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const { Server: SocketIOServer } = require('socket.io');
require('dotenv').config();
const { Agent, run, user, assistant, tool } = require('@openai/agents');
const OpenAI = require('openai');
const { OPENAI_API_KEY } = process.env;
const { z } = require('zod');

// Setup Express
const app = express();
app.use(express.json());
app.use(cors()); // allow CORS for all origins

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
    1.\`bathrooms\` -  required, count of bathrooms, possible values are \`all, 1, 2, 3, 4, 5, 6\`, try to fit value given by user into one the given values, if you can't set value to 'all'
    2. \`bedrooms\` - required, count of bedrooms, possible values are \`all, 1, 2, 3, 4, 5, 6\`, try to fit value given by user into one the given values, if you can't set value to 'all'
    3. priceMin - required, minimal price, any number (minimal and default is 1500), try to fit value given by user into one the given values, if you can't set value to 1500
    4. priceMax  - required, maximal price, any number (max and default is 1500000, try to fit value given by user into one the given values, if you can't set value to 1500000
    5. parkingSpacesMin  - required, minimal amount of parking spaces , any number (default 0) , try to fit value given by user into one the given values, if you can't set value to 0. If user says he doesn't want a RE estate to have parking spaces - set to 0.
    6. parkingSpacesMax - required, maximal amount of parking spaces, any number (default 6), try to fit value given by user into one the given values, if you can't set value to 6
    7. keywords - optional, array of strings, try to make keywords from the leaving information methioned by user (e.g. "I want an appartment with swimming pool and tent - keywords:["pool", "tent", "apprtment"]
- If user didn't mention all the required parameters, reask him/her to mention required ones left.
- Your responces should be generated ONLY in English.
- If user mentioned ALL the parameters during conversation: call tool generate_re_search_url with all parameters and notify client that link to search results will appear below.
`;
// Assistant can be created via API or UI

// ========================
// OpenAI assistant section
// ========================

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  // optional settings
  cors: { origin: '*' },
});

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
  // STT events
  // socket.on('cancel-transcription', (body) => {
  //   // {fileName: string}
  //   console.log('[LOG] cancel-transcription called');
  //   try {
  //     // cancel write stream
  //     // delete created file
  //     // return message that stream is canceled successfuly
  //   } catch (error) {
  //     console.log(error);
  //     // return message that an error occured while trinscribtion
  //   }
  // });

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
  // Agent events
  /**
   * Receives a prompt from user answer in given formats.
   * @param body - contains prompt in form of text and configuration
   * @returns - object with status and data (on failure with errorMessage set to error)
   */
  socket.on('agent-answer:stream', async (body, callback) => {
    console.log('[LOG] voice-file-stream:destory called');
    try {
      const { prompt, formats } = body; // prompt: string, formats = ['text', 'voice']
      const history = chatHistoryMap.get(socket.id) || [];

      history.push(user(prompt));
      chatHistoryMap.set(socket.id, history);

      const result = await run(supportAgent, history, { stream: true });
      const streamText = formats.includes('text');
      const streamVoice = formats.includes('voice');
      let sentenceBuffer = '';
      let agentAnswerBuffer = '';

      const ttsConfig = (inputText) => ({
        model: 'gpt-4o-mini-tts',
        voice: 'coral',
        input: inputText,
        instructions: ttsModelInstruction,
        response_format: 'mp3',
      });

      for await (const event of result) {
        if (event.type === 'raw_model_stream_event') {
          const isDelta = event.data.type === 'output_text_delta';
          const isReponseCompleted = event.data.type === 'response_done';

          const delta = event.data.delta;
          // console.log({
          //   eventType: event.data.type,
          //   dataEvent: event.data.event,
          // });

          if (isDelta && delta) {
            if (streamText) {
              agentAnswerBuffer += delta;
              socket.emit('agent-response:text-chunk', delta);
            }

            if (streamVoice) {
              sentenceBuffer += delta;

              // Check if we have a complete sentence
              if (sentenceBuffer.match(/[.!?]\s/)) {
                const sentences = sentenceBuffer.split(/([.!?]\s)/);
                const completeSentence = sentences[0] + (sentences[1] || '');

                // Generate audio for complete sentence
                const response = await openai.audio.speech.create(
                  ttsConfig(completeSentence)
                );

                // Stream the audio chunks
                for await (const chunk of response.body) {
                  socket.emit('agent-response:audio-chunk', chunk);
                }

                // Update buffer with remaining text
                sentenceBuffer = sentences.slice(2).join('');
              }
            }
          }

          if (isReponseCompleted) {
            socket.emit('agent-response:text-end');
          }
        }
      }

      // Handle any remaining text in buffer
      if (streamVoice && sentenceBuffer.trim()) {
        const response = await openai.audio.speech.create(
          ttsConfig(sentenceBuffer)
        );

        for await (const chunk of response.body) {
          socket.emit('agent-response:audio-chunk', chunk);
        }
      }

      await result.completed;

      // update chat history to reflect agent's answer;
      history.push(assistant(agentAnswerBuffer));
      chatHistoryMap.set(socket.id, history);

      // console.log({ history: chatHistoryMap.get(socket.id) });

      if (streamVoice) {
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

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
