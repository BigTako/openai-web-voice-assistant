const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const { Server: SocketIOServer } = require('socket.io');
require('dotenv').config();
const { Agent, run } = require('@openai/agents');
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

const supportAgent = new Agent({
  name: 'Support Agent',
  instructions: `
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

all the parameters are optional, include them to url ONLY THEN user explicitly mentioned them.
Please do use punctuation signs in sentences you generate.
`,
});

// Assistant can be created via API or UI

// ========================
// OpenAI assistant section
// ========================

// app.post('/message', async (req, res) => {
//   const { message, threadId, prevResponseId } = req.body;
//   console.log(`[${prevResponseId}] Got message ${message}. Processing...`);
//   const response = await openai.responses.create({
//     model: 'o4-mini',
//     stream: false,
//     instructions: assistantInstruction,
//     reasoning: { effort: 'medium' },
//     previous_response_id: prevResponseId,
//     input: message,
//   });
//   const result = {
//     message: response?.output_text,
//     responseId: response?.id,
//   };
//   res.status(200).json(result);
// });

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  // optional settings
  cors: { origin: '*' },
});

/**
 * Stores active voice streaming file names.
 */
const activeStreams = new Map();

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

  const stream = activeStreams.get(fileName);

  if (!stream)
    throw new Error('Error: stream is not initialized by this filename');

  return stream;
}

io.on('connection', (socket) => {
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
      activeStreams.set(fileName, writeStream);
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
      const result = await run(supportAgent, prompt, { stream: true });

      if (formats.includes('text')) {
        for await (const event of result) {
          // these are the raw events from the model
          if (event.type === 'raw_model_stream_event') {
            const isDelta = event.data.type === 'output_text_delta';
            const delta = event.data.delta;
            if (isDelta && delta) {
              socket.emit('agent-response:text-chunk', delta);
            }
          }
        }
      }

      await result.completed;

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

  // socket.on('speak', async ({ text }) => {
  //   try {
  //     console.log('Started receiving speaking requests...');
  //     const response = await openai.audio.speech.create({
  //       model: 'gpt-4o-mini-tts',
  //       voice: 'coral',
  //       input: text,
  //       instructions: 'Speak in a cheerful and positive tone.',
  //       response_format: 'mp3', // stream-friendly
  //     });

  //     let chunkIndex = 0;
  //     const stream = response.body; // Node Readable
  //     console.log(stream);

  //     for await (const chunk of stream) {
  //       socket.emit('audio-chunk', {
  //         data: chunk,
  //         index: chunkIndex++,
  //         timestamp: Date.now(),
  //       });
  //     }
  //     socket.emit('audio-end');
  //   } catch (err) {
  //     console.log(err);
  //     socket.emit('audio-error', { message: err.message });
  //   }
  // });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
