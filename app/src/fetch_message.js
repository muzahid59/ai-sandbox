let onNewMessage = () => {};

export function setOnNewMessage(callback) {
  onNewMessage = callback;
}

export async function listenMessage(message) {
  try {
    const response = await fetch('http://localhost:5001/content-completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: message.text,
        image: message.image,
        model: message.model,
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        onNewMessage({ text: '', sent: false, done: true });
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(5));
            if (data.text) {
              onNewMessage({ text: data.text, sent: false, done: false });
            }
          } catch (e) {
            console.error('Error parsing SSE data:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
    onNewMessage({ text: 'Error: ' + error.message, sent: false, done: true });
  }
}

async function uploadImage(image) {
  try {
    const formData = new FormData();
    formData.append('image', image);
    const response = await fetch('http://localhost:5001/upload', {
      method: 'POST',
      body: formData,
    });
    return await response.text();
  } catch (error) {
    console.error('Error:', error);
  }
}

// export async function listenMessage(message) {
//     const ctrl = new AbortController();

//     const payloadBody = {
//         text: message.text,
//         model: message.model
//     };

//     if (message.image) {
//         const response = await fetch(message.image);
//         console.log('response', response);
//         const blob = await response.blob();
//         console.log('blob', blob);
//         const imageResponse  = await uploadImage(blob);
//         console.log('imageResponse', imageResponse);
//         const imageJson = JSON.parse(imageResponse.replace('data: ', '')); // Remove 'data: ' from the response
//         console.log('imageJson', imageJson);
//         payloadBody.image = imageJson.image;
//     }

//     console.log('payloadBody', payloadBody);

//     const options = {
//         method: 'POST',
//         headers: {
//         'Content-Type': 'application/json',
//         },
//         body: JSON.stringify(payloadBody),
//         signal: ctrl.signal,
//         openWhenHidden: true,
//         async onopen(response) {
//             if (response.ok) {
//                 console.log('Open');
//                 return; // everything's good
//             } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
//                 // client-side errors are usually non-retriable:
//                 console.log('Client side error', response.status);
//             } else {
//                 console.log('Server side error', response.status);
//             }
//         },
//         onmessage(event) {
//             // if the server emits an error message, throw an exception
//             // so it gets handled by the onerror callback below:
//             console.log('event', event);
//             const data = JSON.parse(event.data);
//             onNewMessage({ text: data });
//         },
//         onclose() {
//            console.log('Close');
//         },
//         onerror(err) {
//             console.error('Error:', err);
//         }
//     }
//     console.log('invoke api');
//     fetchEventSource('http://localhost:5001/content-completion', options);

// }
