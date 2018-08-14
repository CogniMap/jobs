export function debug(message) {
    if (process.env['JOBS_DEBUG'] != null) {
        console.log(message);
    }
}

export function debug2(message, obj) {
    if (process.env['JOBS_DEBUG'] != null) {
        console.log(message, obj);
    }
}
