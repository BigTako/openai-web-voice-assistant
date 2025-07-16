import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import './App.css';
import { socket } from './utils/socketClient';

type TMessage = {
  from: TSenderType;
  content?: string;
  contentType?: 'text' | 'html';
  recordingFileName?: string;
  status: 'created' | 'pending' | 'error';
};

type TSocketResponse<D> = {
  status: 'success' | 'error';
  errorMessage?: string;
  data?: D;
};

function broswerSupportsSoundingOut() {
  const supportedBrowsers = ['Chrome', 'Edge', 'OPR', 'Opera'];
  const userAgent = navigator.userAgent;
  const isCurrentBrowserSupported = supportedBrowsers.some((bname) =>
    userAgent.includes(bname)
  );
  return isCurrentBrowserSupported;
}

function Message({ message }: { message: TMessage }) {
  const { from, content, status } = message;
  const contentType = message.contentType || 'text';
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
          wordBreak: 'break-all',
        }}
      >
        {(status === 'created' || status === 'error') && (
          <>
            {contentType === 'text' ? (
              content
            ) : (
              <span dangerouslySetInnerHTML={{ __html: content || '' }} />
            )}
          </>
        )}
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
  const [isGettingAgentAnswer, setIsGettingAgentAnwer] = useState(false);
  const [finalSearchUrl, setFinalSearchUrl] = useState<string | null>(null);
  const [isVoiceOverResponsesSupported, setIsVoiceOverResponsesSupported] =
    useState<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const chunkQueueRef = useRef<ArrayBuffer[]>([]);
  const endOfChatRef = useRef<HTMLDivElement | null>(null);
  const isProcessingRef = useRef(false);

  const scrollToBottomOfTheChat = useCallback(() => {
    if (endOfChatRef.current) {
      endOfChatRef.current.scrollIntoView({
        behavior: 'smooth',
      });
    }
  }, []);

  const showDevLogs = import.meta.env.VITE_NODE_ENV === 'development';

  // console.log({ showDevLogs });

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
      if (showDevLogs)
        console.log(
          'Finished recording and started processing transcription...'
        );
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
          {
            from: 'bot',
            status: 'pending',
          },
        ]);
      }
      setIsMenuOpened(false);
      setIsGettingAgentAnwer(true); // trigger AI agent request
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
      if (showDevLogs) console.log('Started recording voice...');
      setIsMenuOpened(true);
      setIsRecording(true);
      setFinalSearchUrl(null);
      const response = (await socket.emitWithAck(
        'voice-file-stream:init'
      )) as TSocketResponse<{ fileName: string }>;
      checkResponseError(response);
      const filename = response.data?.fileName;
      // console.log({ filename });
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

  useEffect(() => {
    setIsVoiceOverResponsesSupported(broswerSupportsSoundingOut());
  }, []);

  // recording voice from microfone
  useEffect(() => {
    if (pendingFileName) {
      async function streamAudio() {
        // ask and access to micro
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
        if (showDevLogs) console.log('Started streaming audio...');
        streamAudio();
      } catch (error) {
        console.log('Error while streaming audio');
        console.log(error);
        pushError(error);
        setRecorder(null);
        setIsRecording(false);
      }
    }
  }, [pendingFileName, pushError, showDevLogs]);

  // request agent answer
  useEffect(() => {
    if (isGettingAgentAnswer) {
      async function requestAgentAnswer() {
        const lastUserMessage = chatHistory
          .filter((message) => message.from === 'user')
          .pop();
        const response = (await socket.emitWithAck('agent-answer', {
          prompt: lastUserMessage?.content,
          streamVoice: true,
        })) as TSocketResponse<{ text: string }>;
        checkResponseError(response);
        const agentTextAnswer = response.data?.text;

        if (agentTextAnswer) {
          setChatHistory((prev) => {
            // Append delta to last assistant message
            const updated = [...prev];
            const idx = updated.length - 1;
            const chatMessage = updated[idx];
            if (chatMessage) {
              // Create a new object instead of mutating the existing one
              updated[idx] = {
                ...chatMessage,
                content: agentTextAnswer,
                status: 'created',
              };
            }

            return updated;
          });
        } else {
          throw new Error('No answer from agent. Please try again.');
        }
      }
      try {
        if (showDevLogs) console.log('Requested agent answer...');
        requestAgentAnswer();
      } catch (error) {
        console.log('Error while requesting agent answer');
        console.log(error);
        pushError(error);
      } finally {
        setIsGettingAgentAnwer(false);
      }
    }
  }, [
    isGettingAgentAnswer,
    chatHistory,
    pushError,
    finalSearchUrl,
    showDevLogs,
  ]);

  useEffect(() => {
    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;

    if (audioRef.current) {
      audioRef.current.src = URL.createObjectURL(mediaSource);
      audioRef.current.preload = 'auto';
    }

    mediaSource.addEventListener('sourceopen', () => {
      if (!sourceBufferRef.current) {
        const sb = mediaSource.addSourceBuffer('audio/mpeg');
        sb.mode = 'sequence';
        sourceBufferRef.current = sb;

        sb.addEventListener('updateend', () => {
          isProcessingRef.current = false;
          processNextChunk();
        });
      }
    });

    return () => {
      // Cleanup on unmount
      if (mediaSourceRef.current) {
        if (mediaSourceRef.current.readyState === 'open') {
          mediaSourceRef.current.endOfStream();
        }
        URL.revokeObjectURL(audioRef.current?.src || '');
      }
    };
  }, []);

  useEffect(() => {
    // finalSearchUrl
    try {
      socket.on('receive-search-url', (url) => {
        if (showDevLogs) console.log(`Received final search url: ${url}`);
        if (!url) throw new Error('No url in the response');
        setFinalSearchUrl(url);
      });
    } catch (error) {
      console.log('Error while receiving search url');
      console.log(error);
      pushError(error);
    }
    return () => {
      socket.off('receive-search-url');
    };
  }, [pushError, showDevLogs]);

  // Handle audio streaming for each agent response
  useEffect(() => {
    if (isGettingAgentAnswer) {
      // Reset for new response
      chunkQueueRef.current = [];
      isProcessingRef.current = false;

      // Clear existing buffer content if needed
      const sb = sourceBufferRef.current;
      if (sb && !sb.updating) {
        try {
          if (sb.buffered.length > 0) {
            // remove everything from buffer
            sb.remove(0, sb.buffered.end(sb.buffered.length - 1));
          }
        } catch (error) {
          console.log('Error clearing buffer:', error);
        }
      }
    }

    const handleAudioChunk = (chunk: ArrayBuffer) => {
      // console.log('received chunk');
      chunkQueueRef.current.push(chunk);
      processNextChunk();
    };

    const handleAudioEnd = () => {
      const flush = () => {
        if (!isProcessingRef.current && chunkQueueRef.current.length === 0) {
          // Don't end the stream, just stop processing for this response
          if (showDevLogs) console.log('Audio response completed');
        } else {
          setTimeout(flush, 10);
        }
      };
      flush();
    };

    socket.on('agent-response:audio-chunk', handleAudioChunk);
    socket.on('agent-response:audio-end', handleAudioEnd);

    return () => {
      socket.off('agent-response:audio-chunk', handleAudioChunk);
      socket.off('agent-response:audio-end', handleAudioEnd);
    };
  }, [isGettingAgentAnswer, showDevLogs]);

  useEffect(() => {
    scrollToBottomOfTheChat();
  }, [chatHistory, scrollToBottomOfTheChat]);

  useEffect(() => {
    socket.on('setup-final-search-url', () => {
      // console.log(`Append messsage with final search url ${finalSearchUrl}`);
      if (finalSearchUrl) {
        setChatHistory((prev) => [
          ...prev,
          {
            from: 'bot',
            contentType: 'html',
            content: `<a href="${finalSearchUrl}" target="_blank">Click here to review search results</a>`,
            status: 'created',
          },
        ]);
        setFinalSearchUrl(null);
      }
    });
    return () => {
      socket.off('setup-final-search-url');
    };
  }, [finalSearchUrl]);

  // get agent voice ansewr chunk by chunk
  const processNextChunk = () => {
    const sb = sourceBufferRef.current;
    if (
      !sb ||
      isProcessingRef.current ||
      chunkQueueRef.current.length === 0 ||
      sb.updating
    ) {
      return;
    }

    isProcessingRef.current = true;
    const data = chunkQueueRef.current.shift()!;

    try {
      sb.appendBuffer(new Uint8Array(data));
    } catch (error) {
      console.error('Error appending buffer:', error);
      isProcessingRef.current = false;
    }
  };

  const nothingInChatYet = !chatHistory.length;
  const showVoiceOverNotSupportedMessage =
    isVoiceOverResponsesSupported === false;

  return (
    <>
      <audio ref={audioRef} autoPlay />
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
          {showVoiceOverNotSupportedMessage && (
            <div style={{ color: 'gray' }}>
              😔 Unfortunatelly, current browser does not support voice-over
              responses, please use chromium based one like Chrome, Opera, Brave
              or Edge
            </div>
          )}
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
                height: '100%',
                width: 'calc(100% - 25px)',
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
                chatHistory.map((message, i) => (
                  <Message
                    key={`${message.from}-message-${i}`}
                    message={message}
                  />
                ))
              )}
              <div id='end-of-chat' ref={endOfChatRef}></div>
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
                  justifyContent: isRecording ? 'space-between' : 'flex-end',
                }}
              >
                {isRecording && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 20,
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
                    marginRight: 20,
                    // marginLeft: 'auto',
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
    </>
  );
}

export default App;
