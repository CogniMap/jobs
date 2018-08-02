import {update} from '../immutability';

import {TaskHash} from '../index.d';

export function getResultContext(task: TaskHash, context = {}) {
    try {
        for (let updater of task.contextUpdaters || []) {
            context = update(context, updater);
        }
    } catch (e) {
        console.warn(e);
    }
    return context;
}
