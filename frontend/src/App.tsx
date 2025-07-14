import { useEffect, useState } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';

import './App.css';
import { socket } from './utils/socketClient';

type TMessageProps = {
  content: string;
  from: 'user' | 'bot';
};

function Message({ content, from }: TMessageProps) {
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
          padding: 10,
          backgroundColor: from === 'user' ? '#303030' : 'transparent',
          borderRadius: 10,
        }}
      >
        {content}
      </div>
    </div>
  );
}

function App() {
  const chatHistory = [
    {
      from: 'user',
      content:
        'i receive a stream of text(chunks) on front-end from backend, can i sound it out by chunks using openai library fro node.js?',
    },
    {
      from: 'bot',
      content:
        'Yes—you can have the OpenAI Node.js SDK spit out audio as soon as each chunk arrives, so you don’t have to wait for the full file before playing it.',
    },
    {
      from: 'user',
      content: `Is there a separate instruction for incrementing the instruction address register in the CPU or it's done automaticaly when current instruction is executed? If automaticaly and the current instruction is JUMP, it has to overwrite the current instruction address, and then increment it since the JUMP instruction is executed, so it works weird`,
    },
    {
      from: 'bot',
      content:
        'There is no explicit “INC PC” instruction in almost any real CPU ISA; PC (or IP — Instruction Pointer) updating is baked into the fetch/decode hardware. Here’s roughly what happens each cycle:',
    },
  ] as { from: 'user' | 'bot'; content: string }[];

  const [isRecording, setIsRecording] = useState(false);
  const [isSubmittingRecording, setIsSubmittingRecording] = useState(false);

  const handleSubmitVoice = () => {
    setIsSubmittingRecording(true);
  };

  const handleStartRecording = () => {
    setIsRecording(true);
  };

  const handleCancelRecording = () => {
    setIsRecording(false);
  };

  useEffect(() => {
    socket.on('connect', () => {});
  }, []);

  // console.log({ socket: socket.connected });

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
            padding: 10,
            gap: 20,
          }}
        >
          {chatHistory.map((message) => (
            <Message content={message.content} from={message.from} />
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
