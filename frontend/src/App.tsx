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
  const [chatHistory, setChatHistory] = useState<TMessage[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [isSubmittingRecording, setIsSubmittingRecording] = useState(false);
  const [isMenuOpened, setIsMenuOpened] = useState(false);
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
      console.log('Finished recording and started processing transcription...');
      recorder?.stop();
      const response = (await socket.emitWithAck('get-transacription', {
        fileName: pendingFileName,
      })) as TSocketResponse<{ text: string }>;
      checkResponseError(response);
      const transcription = response.data?.text;
      if (!transcription)
        throw new Error('No transcription in the response, please try again.');

      if (pendingFileName) {
        setChatHistory((current) => [
          ...current,
          {
            from: 'user',
            status: 'created',
            recordingFileName: pendingFileName,
            content: transcription,
          },
        ]);
      }
      setIsMenuOpened(false);
    } catch (error) {
      console.log(error);
      pushError(error);
    } finally {
      setPendingFileName(null);
      setIsSubmittingRecording(false);
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
      setIsMenuOpened(true);
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
          setIsRecording(false);
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

  const nothingInChatYet = !chatHistory.length;

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
            width: '100%',
            height: 500,
            overflowY: 'scroll',
            overflowX: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              paddingRight: 25,
              gap: 20,
            }}
          >
            {nothingInChatYet ? (
              <div
                style={{
                  display: 'flex',
                  height: '100%',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                Nothing in chat yet
              </div>
            ) : (
              chatHistory.map((message) => <Message message={message} />)
            )}
          </div>
        </div>
        {isMenuOpened ? (
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
              {isRecording && (
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
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginLeft: 'auto',
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
