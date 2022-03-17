let connectionForm = document.querySelector('#connectionForm')
let webrtcForm = document.querySelector('#webrtcForm')
let teacherForm = document.querySelector('#teacherForm')
let membersForm = document.querySelector('#membersForm')

let inpSignalingHost = document.querySelector('#inpSignalingHost')
let inpResourceName = document.querySelector('#inpResourceName')
let inpResourceId = document.querySelector('#inpResourceId')
let inpJWT = document.querySelector('#inpJWT')
let btnConnect = document.querySelector('#btnConnect')

let btnDisconnect = document.querySelector('#btnDisconnect')

let membersListContainer = document.querySelector('#membersListContainer')
let streamCamera = document.querySelector('#streamCamera')
let teacherCamera = document.querySelector('#teacherStream')

let log = console

/* ** Websocket ** */

let wsCon
let wsPingInterval
let cmdHandlers = {} // map[cmd][func(data), ...]

function appendCmdHandler(cmd, handler) {
    if (!cmdHandlers.hasOwnProperty(cmd)) {
        cmdHandlers[cmd] = []
    }
    cmdHandlers[cmd].push(handler)
}

function wsOpen(url) {
    if(wsCon != null) {
        console.error(new Error('websocket соединение уже установлено'))
        return
    }
    // let url = `${inpSignalingHost.value}/${inpResourceName.value}/${inpResourceId.value}?token=${inpJWT.value}`
    log.info('устанавливаю websocket соединение', url)

    wsCon = new WebSocket(url)
    wsCon.onopen = wsOnOpen
    wsCon.onerror = wsOnError
    wsCon.onmessage = wsOnMessage
}
function wsClose() {
    if (wsCon == null) {
        return
    }

    log.info('закрываю websocket соединение')
    clearInterval(wsPingInterval)
    wsCon.close()
    wsCon = null
    wsPingInterval = null
}
function wsSend(data) {
    console.log('отправляю данные', data)
    wsCon.send(JSON.stringify(data))
}
function wsOnOpen() {
    console.log('установлено WS подключение')
    wsPingInterval = setInterval(wsPing, 1000)
}
function wsOnError(err) {
    console.error(err)
    wsClose()
}
function wsPing() {
    if (wsCon.readyState !== WebSocket.OPEN) {
        console.warn('websocket соединение закрыто')
        wsClose()
    }
}
function wsOnMessage(msg) {
    console.log('входящее сообщение', msg.data)

    let data = JSON.parse(msg.data)
    console.log('данные сообщения', data)

    if(!data.hasOwnProperty('cmd')) {
        log.warn('не определена команда', data)
        return
    }

    if (cmdHandlers.hasOwnProperty(data.cmd)) {
        for (let k in cmdHandlers[data.cmd]) {
            cmdHandlers[data.cmd][k](data)
        }
    } else {
        log.warn('неизвестная команда', data)
    }
}

/* ** RTCPeerConnection ** */
let rtcCnf

class rtcCon {

    constructor(member, domVideo, camera) {
        this.member = member
        this.domVideo = domVideo
        this.outRtc = null
        this.inpRtc = null
        this.camera = camera
        this.recSenders = {}
    }

    close() {
        if (this.inpRtc) {
            this.inpRtc.close()
        }
        if (this.outRtc) {
            this.outRtc.close()
        }
        if (this.camera) {
            this.camera.muted = true
        }
    }

    addAudioTrackToRecorder(recorder) {
        console.log('ADD REC 0', this.inpRtc)
        let remoteStream = this.inpRtc.getRemoteStreams()[0]
        let recId = recorder.member.user_id
        console.log('ADD REC 1', remoteStream)
        this.recSenders[recId] = recorder.outRtc.addTrack(remoteStream.getAudioTracks()[0], remoteStream)

        console.log('ADD REC 2', this.recSenders[recId])
        console.log('ADD REC 3', recorder.outRtc.addTransceiver(remoteStream.getAudioTracks()[0]))
    }

    removeAudioTrackToRecorder(recorder) {
        let recId = recorder.member.user_id
        if (this.recSenders.hasOwnProperty(recId)) {
            recorder.outRtc.removeTrack(this.recSenders[recId])
        }
        delete this.recSenders[recId]
    }

    createRtc() {
        let member = this.member
        log.info('создаю RTCPeerConnection с участником', member)
        if(!hasRTCPeerConnection()) {
            log.error('нет доступа к RTC peer connection')
            alert('браузер не поддерживает RTC peer connection')
            return
        }
        if (!this.member.hasOwnProperty('user_id')) {
            log.error('у участника не определён user_id', member)
            return
        }

        let rtcCon = new window.RTCPeerConnection(rtcCnf)
        rtcCon.onicegatheringstatechange =rtcLogEvent
        rtcCon.onnegotiationneeded =rtcLogEvent
        rtcCon.onsignalingstatechange =rtcLogEvent
        rtcCon.onaddtrack =rtcLogEvent

        return rtcCon
    }

    createOffer() {
        let member = this.member
        if (!this.outRtc) {
            this.outRtc = this.createRtc(true)
            this.outRtc.addStream(this.camera)
            this.outRtc.onicecandidate = (event) => {
                wsSend({
                    cmd: 'candidate',
                    params: {
                        candidate: event.candidate,
                        to: member.user_id,
                        type: 'out'
                    }
                })
            }

        } else {
            return
        }
        let rtcCon = this.outRtc
        rtcCon.createOffer().then(offer => {
            log.info('создан офер', offer)
            rtcCon.setLocalDescription(offer).then(
                () => {
                    wsSend({
                        cmd: 'offer',
                        params: {
                            offer: offer,
                            to: member.user_id
                        }
                    })
                },
                err => {
                    log.error('ошибка при установке offer', err)
                }
            )
        }, err => {
            log.error('ошибка при создании офера', member, err)
        })
    }

    createAnswer() {
        let member = this.member
        let rtcCon = this.inpRtc
        rtcCon.createAnswer().then(answer => {
            log.log('создан answer', answer)
            rtcCon.setLocalDescription(answer).then(
                () => {
                    log.log('отправляю answer', answer)
                    wsSend({
                        cmd: 'answer',
                        params: {
                            answer: answer,
                            to: member.user_id
                        }
                    })
                },
                err => {
                    log.error('ошибка при установке answer', err)
                }
            )
        }, err => {log.error('ошибка при создании answer', err)})
    }

    acceptOffer(offer) {
        if (!this.inpRtc) {
            let member = this.member
            let domVideo = this.domVideo
            this.inpRtc = this.createRtc()
            this.inpRtc.ontrack = (event) => {
                log.info('входящий медиа-поток', event)
                if (event.streams && event.streams[0]) {
                    domVideo.srcObject = event.streams[0]
                } else {
                    log.error('oops...')
                }
            }
            this.inpRtc.onicecandidate = (event) => {
                wsSend({
                    cmd: 'candidate',
                    params: {
                        candidate: event.candidate,
                        to: member.user_id,
                        type: 'inp'
                    }
                })
            }
        }
        this.inpRtc.setRemoteDescription(offer).then(() => {
            log.log('принят удалённый offer', offer)
        }, err => {
            log.error('ошибка принятия офера', offer, err)
        })
    }

    acceptAnswer(answer) {
        this.outRtc.setRemoteDescription(answer).then(() => {
            log.log('принят удалённый answer', answer)
        }, err => {
            log.error('ошибка принятия answer', answer, err)
        })
    }

    addCandidate(params) {
        if (params.candidate == null) {
            return
        }

        let rtcCon
        if (params.type === 'out') {
            rtcCon = this.inpRtc
        } else {
            rtcCon = this.outRtc
        }

        if (!rtcCon) {
            log.error('не определён RTCPeerConnection', params)
            return
        }

        if (
            rtcCon.currentLocalDescription == null &&
            rtcCon.currentRemoteDescription == null
        ) {
            log.warn('ещё не установлены LocalDescription && RemoteDescription')
            return
        }

        rtcCon.addIceCandidate(new RTCIceCandidate(params.candidate)).then(
            r => {
                log.log('кандидат добавлен')
            },
            err => {
                log.error('ошибка при добавлении candidate', err)
            }
        )
    }
}

/* {
    user_id: {
        rtcCon: {
            out: RTCPeerConnection // исходящий стрим, тот что генерим вместе с офером
            inp: RTCPeerConnection // входящий стрим, тот что генерим при получении офера
        }
        member: {}
    }
} */
let rtcMembersPeerCons = {}

let cameraStream

function hasRTCPeerConnection() {
    window.RTCPeerConnection = window.RTCPeerConnection ||
        window.webkitRTCPeerConnection ||
        window.mozRTCPeerConnection;
    return !!window.RTCPeerConnection;
}
function hasUserMedia() {
    navigator.getUserMedia = navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;
    return !!navigator.getUserMedia;
}
// opt {video:true, audio:true}
function rtcOpenCameraStream(opt) {
    return new Promise((resolver, reject) => {
        log.info('инициализирую камеру')
        if(!hasUserMedia()) {
            reject('камера не доступна')
        } else {
            navigator.getUserMedia(opt, stream => {
                if (stream) {
                    resolver(stream)
                } else {
                    reject('не смог инициализировать камеру')
                }
            }, err => {
                reject(err)
            })
        }

    })
}
function rtcOpenScreenStream() {
    return new Promise((resolver, reject) => {
        log.info('инициализирую демонстрацию экрана')
        navigator.mediaDevices.getDisplayMedia({video:true, audio:false}).then(
            stream => {
                resolver(stream)
            },
            err => {
                reject(err)
            }
        )
    })
}

function mutedCamera(stream, isMuted) {
    log.info('audio track set muted', isMuted, stream)
    stream.getAudioTracks().forEach((v) => {
        log.debug('audio track set muted', isMuted, v)
        v.enabled = isMuted !== true
    })
}

function rtcCloseAll() {
    for (let k in rtcMembersPeerCons) {
        if (rtcMembersPeerCons.hasOwnProperty(k)) {
            rtcMembersPeerCons[k].close()
            delete rtcMembersPeerCons[k]
        }
    }
}

function rtcRemoveAudioTrackToRecorders(srcUserId) {
    log.debug('rtcRemoveAudioTrackToRecorders')
    let src
    let recorders = []
    for (let k in rtcMembersPeerCons) {
        if (rtcMembersPeerCons.hasOwnProperty(k)) {
            if (rtcMembersPeerCons[k].member.is_recorder) {
                recorders.push(rtcMembersPeerCons[k])
            } else if (rtcMembersPeerCons[k].member.user_id === srcUserId) {
                src = rtcMembersPeerCons[k]
            }
        }
    }

    if (recorders.length === 0) {
        log.error('нет ни одного рекордера')
        return
    }
    if (!src) {
        log.error('не найден участник', srcUserId)
        return
    }

    recorders.forEach(r => {
        src.removeAudioTrackToRecorder(r)
    })
}

function rtcAddAudioTrackToRecorders(srcUserId) {
    log.debug('rtcAddAudioTrackToRecorders')
    let src
    let recorders = []
    for (let k in rtcMembersPeerCons) {
        if (rtcMembersPeerCons.hasOwnProperty(k)) {
            if (rtcMembersPeerCons[k].member.is_recorder) {
                recorders.push(rtcMembersPeerCons[k])
            } else if (rtcMembersPeerCons[k].member.user_id === srcUserId) {
                src = rtcMembersPeerCons[k]
            }
        }
    }

    if (recorders.length === 0) {
        log.error('нет ни одного рекордера')
        return
    }
    if (!src) {
        log.error('не найден участник', srcUserId)
        return
    }

    recorders.forEach(r => {
        src.addAudioTrackToRecorder(r)
    })
}

//*******//
function rtcLogEvent(event) {
    log.info('EVENT', event.type, event.target)
}

/**/
