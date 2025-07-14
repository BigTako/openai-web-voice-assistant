import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import './App.css';
import { socket } from './utils/socketClient';

type TMessage = {
  from: TSenderType;
  content?: string;
  recordingFileName?: string;
  status: 'created' | 'pending' | 'error';
};

type TSocketResponse<D> = {
  status: 'success' | 'error';
  errorMessage?: string;
  data?: D;
};

function Message({ message }: { message: TMessage }) {
  const { from, content, status } = message;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      <h3 style={{ margin: 0, textAlign: 'start' }}>
        {from === 'user' ? 'You' : '🤖 Bot'}
      </h3>
      <div
        style={{
          textAlign: 'start',
          width: status === 'pending' ? 'fit-content' : '100%',
          padding: 10,
          backgroundColor:
            status === 'error'
              ? 'red'
              : from === 'user'
              ? '#303030'
              : 'transparent',
          borderRadius: 10,
        }}
      >
        {(status === 'created' || status === 'error') && <>{content}</>}
        {status === 'pending' && (
          <div
            style={{ width: 40, height: 20 }}
            className='message-pending-loader'
          ></div>
        )}
      </div>
    </div>
  );
}
type TSenderType = 'user' | 'bot';

function App() {
  const chatHistory = useMemo(
    () => [
      {
        from: 'user',
        recordingFileName: '',
        status: 'created',
        content:
          'i receive a stream of text(chunks) on front-end from backend, can i sound it out by chunks using openai library fro node.js?',
      },
      {
        from: 'bot',
        status: 'created',
        content:
          'Yes—you can have the OpenAI Node.js SDK spit out audio as soon as each chunk arrives, so you don’t have to wait for the full file before playing it.',
      },
      {
        from: 'user',
        recordingFileName: '',
        status: 'created',
        content: `Is there a separate instruction for incrementing the instruction address register in the CPU or it's done automaticaly when current instruction is executed? If automaticaly and the current instruction is JUMP, it has to overwrite the current instruction address, and then increment it since the JUMP instruction is executed, so it works weird`,
      },
      {
        from: 'bot',
        status: 'created',
        content:
          'There is no explicit “INC PC” instruction in almost any real CPU ISA; PC (or IP — Instruction Pointer) updating is baked into the fetch/decode hardware. Here’s roughly what happens each cycle:',
      },
    ],
    []
  ) as TMessage[];

  const [isRecording, setIsRecording] = useState(false);
  const [isSubmittingRecording, setIsSubmittingRecording] = useState(false);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

  function checkResponseError<T>(response: TSocketResponse<T>) {
    if (response.status === 'error') {
      const defaultError = 'Something went wrong.Please try again.';
      const message = response.errorMessage || defaultError;
      if (response.errorMessage) throw new Error(message);
    }
  }

  const handleSubmitVoice = async () => {
    try {
      setIsSubmittingRecording(true);
      console.log('Finished recording and started processing...');
      recorder?.stop();
    } catch (error) {
      console.log(error);
      pushError(error);
      setPendingFileName(null);
    }
  };

  const pushError = useCallback(
    function (error: unknown) {
      const e = error as Error;
      const errorMessage =
        e?.message || 'Something went wrong.Please try again.';
      const message = {
        from: 'bot',
        content: errorMessage,
        status: 'error',
      } as TMessage;
      chatHistory.push(message);
    },
    [chatHistory]
  );

  const handleStartRecording = async () => {
    try {
      console.log('Started recording voice...');
      setIsRecording(true);
      const response = (await socket
        .emitWithAck('voice-file-stream:init')
        .then((data) => {
          console.log(data);
          return data;
        })) as TSocketResponse<{ fileName: string }>;

      checkResponseError(response);

      const filename = response.data?.fileName;
      console.log({ filename });
      if (filename) {
        setPendingFileName(filename);
      } else {
        console.log('Error: No filename');
        throw new Error('Error initializing voice transcription');
      }
    } catch (error) {
      console.log(error);
      pushError(error);
      setPendingFileName(null);
      setIsRecording(false);
    }
  };

  const handleCancelRecording = () => {
    setIsRecording(false);
  };

  console.log({ pendingFileName });

  useEffect(() => {
    if (pendingFileName) {
      async function streamAudio() {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const recorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
        });

        setRecorder(recorder);

        recorder.ondataavailable = async ({ data }) => {
          const response = (await socket.emitWithAck(
            'voice-file-stream:chunk',
            {
              fileName: pendingFileName,
              chunk: data,
            }
          )) as TSocketResponse<null>;

          checkResponseError(response);
        };

        recorder.onstop = async () => {
          // close BE writting stream
          const response = await socket.emitWithAck(
            'voice-file-stream:destroy',
            {
              fileName: pendingFileName,
            }
          );
          checkResponseError(response);
        };
        recorder.start(500);
      }

      try {
        console.log('Started streaming audio...');
        streamAudio();
      } catch (error) {
        console.log('Error while streaming audio');
        console.log(error);
        pushError(error);
        setRecorder(null);
        setIsRecording(false);
      }
    }
  }, [pendingFileName, pushError]);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: '50%',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: 500,
            overflowY: 'scroll',
            overflowX: 'hidden',
            padding: 10,
            gap: 20,
          }}
        >
          {chatHistory.map((message) => (
            <Message message={message} />
          ))}
        </div>
        {isRecording ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              backgroundColor: '#303030',
              width: '100%',
              borderRadius: 20,
              padding: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 20,
                }}
              >
                <span className='recording'></span>
                <div>Recording...</div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <button
                  title='Cancel recording'
                  onClick={handleCancelRecording}
                  disabled
                  style={{
                    backgroundColor: 'transparent',
                    borderRadius: '100%',
                    padding: 7,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <XIcon size={20} />
                </button>
                <button
                  title='Submit speech'
                  style={{
                    backgroundColor: 'transparent',
                    borderRadius: '100%',
                    padding: 7,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  onClick={handleSubmitVoice}
                >
                  {isSubmittingRecording ? (
                    <span className='loader'></span>
                  ) : (
                    <CheckIcon size={20} />
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            style={{
              width: '100%',
              backgroundColor: '#00FF7F',
              padding: 10,
              borderRadius: 20,
            }}
            onClick={handleStartRecording}
          >
            <span style={{ color: '#303030' }}>
              <strong>Start recording</strong>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
