const colors = require("colors");

export function debug(type: "SUPERVISION" | "WORKER" | "TASK", message) {
    if (process.env['JOBS_DEBUG'] != null) {
        if (type == "SUPERVISION") {
            console.log(colors.green('[JOBS - SUPERVISION] ' + message));
        } else if (type == "WORKER") {
            console.log(colors.cyan('[JOBS - WORKER] ' + message));
        } else if (type == "TASK") {
            console.log(colors.yellow('[JOBS - WORKER] ' + message));
        } else {
            console.log('[JOBS] ' + message);
        }
    }
}

export function debug2(type: "SUPERVISION" | "WORKER" | "TASK", message, obj) {
    if (process.env['JOBS_DEBUG'] != null) {
        if (type == "SUPERVISION") {
            console.log(colors.green('[JOBS - SUPERVISION] ' + message), obj);
        } else if (type == "WORKER") {
            console.log(colors.cyan('[JOBS - WORKER] ' + message), obj);
        } else if (type == "TASK") {
            console.log(colors.yellow('[JOBS - WORKER] ' + message), obj);
        } else {
            console.log('[JOBS] ' + message, obj);
        }
    }
}
