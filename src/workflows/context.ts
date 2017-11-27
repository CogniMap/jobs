import { update } from '../immutability';

import { TaskHash } from '../index.d';

export function getResultContext(task : TaskHash, context = {})
{
                               for (let updater of task.contextUpdaters) {
                                   context = update(context, updater);
                               }
                               return context;
}