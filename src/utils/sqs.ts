import {debug, debug2} from "../logging";

/**
 * Be sure to not forget a done() in an error handler for example
 * @param {"WORKER" | "SUPERVISION"} type
 * @param promiseCreator
 * @returns {(message, _done) => void}
 */
export function createMessageHandler(type: "WORKER" | "SUPERVISION", promiseCreator) {
    return (message, _done) => {
        function done() {
            debug(type, 'Message handled');
            _done();
        }

        debug2(type, 'Receive message : ', message.Body);
        try {
            let res = promiseCreator(message);
            if (res != null && res.then != null) {
                res.then(() => {
                    done();
                }).catch(e => {
                    console.error(e);
                    done();
                })
            } else {
                done();
            }
        } catch (e) {
            console.error(e);
            done();
        }
    }
}