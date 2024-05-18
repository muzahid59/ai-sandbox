import { fetchEventSource } from  '@microsoft/fetch-event-source'

let onNewMessage = (message) => {};

export function setOnNewMessage(callBack) {
    onNewMessage = callBack;
}   

export async function fetchMessage(query) {
    const response = await fetch('http://localhost:3000/text-completion', {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: query }),
    });
    return await response.text();
}


export function listenMessage(query) {
    const ctrl = new AbortController();
    const options = {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: query }),
        signal: ctrl.signal,
        openWhenHidden: true,
        async onopen(response) {
            if (response.ok) {
                console.log('Open');
                return; // everything's good
            } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                // client-side errors are usually non-retriable:
                console.log('Client side error', response.status);
            } else {
                console.log('Server side error', response.status);
            }
        },
        onmessage(event) {
            // if the server emits an error message, throw an exception
            // so it gets handled by the onerror callback below:
            console.log('event', event);
            const data = JSON.parse(event.data);
            onNewMessage(data);
        },
        onclose() {
           console.log('Close');
        },
        onerror(err) {
            console.error('Error:', err);
        }
    }

    fetchEventSource('http://localhost:3000/text-completion', options);
    
}