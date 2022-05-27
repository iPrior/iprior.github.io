class Webrtc {
    constructor(onTrackCallback, onIceCandidateCallback, onNegotiationNeededCallback) {
        this.con = null
        this.candidatesPool = []
        this.candidatesInterval = null
        this.onTrack = onTrackCallback.bind(this)
        this.onIceCandidate = onIceCandidateCallback.bind(this)
        this.onNegotiationNeeded = onNegotiationNeededCallback.bind(this)

        this._micSender = null
        this._cameraSender = null
        this._screenSender = null
    }

    initRTC(conf) {
        this.con = new RTCPeerConnection(conf)

        this.con.onconnectionstatechange = this.logEvent()
        this.con.ondatachannel = this.logEvent()
        this.con.oniceconnectionstatechange = this.logEvent()
        this.con.onicegatheringstatechange = this.logEvent()
        this.con.onsignalingstatechange = this.logEvent()

        this.con.onicecandidateerror = this.onIceCandidateError.bind(this)
        this.con.onnegotiationneeded = this.onNegotiationNeeded.bind(this)

        this.con.onicecandidate = this.onIceCandidate
        this.con.ontrack = this.onTrack
    }

    set micSender(value) {
        this._micSender = value;
    }

    set cameraSender(value) {
        this._cameraSender = value;
    }

    set screenSender(value) {
        this._screenSender = value;
    }

    close() {
        this.con.close()
    }

    addTrack(track, stream) {
        let sender =  this.con.addTrack(track, stream)
        console.warn('sender', sender, sender.getParameters())
        return sender
    }

    addMic(stream) {
        this._micSender = this.addTrack(stream.getAudioTracks()[0], stream)
    }

    addCamera(stream) {
        this._cameraSender = this.addTrack(stream.getVideoTracks()[0], stream)
        console.warn("camera", "sender", this.con, this.con.getReceivers())
    }

    addScreen(stream) {
        this._screenSender = this.addTrack(stream.getVideoTracks()[0], stream)
    }

    removeMic() {
        if (this._micSender) {
            this.con.removeTrack(this._micSender)
        }
    }

    removeCamera() {
        if (this._cameraSender) {
            this.con.removeTrack(this._cameraSender)
        }
    }

    removeScreen() {
        if (this._screenSender) {
            this.con.removeTrack(this._screenSender)
        }
    }

    onIceCandidateError(e) {
        console.error('onICECandidateError', JSON.stringify(e), e)
    }

    addIceCandidate(candidate) {
        if (!candidate) {
            return
        }

        if (this.con && this.con.remoteDescription) {
            this.con.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error)
            return
        }

        this.candidatesPool.push(candidate)

        if (this.candidatesInterval == null) {
            let handler = () => {
                if (this.con && this.con.remoteDescription) {
                    let addc = (c) => {
                        this.con.addIceCandidate(new RTCIceCandidate(c)).catch(console.error)
                    }
                    this.candidatesPool.map(addc.bind(this))
                    clearInterval(this.candidatesInterval)
                    this.candidatesInterval = null
                }
            }
            this.candidatesInterval = setInterval(handler.bind(this), 300)
        }
    }

    setOffer(offer) {
        return this.con.setRemoteDescription(offer)
    }

    createAnswer() {
        let setAnswer = (function (answer, resolve) {
            this.con.setLocalDescription(answer).then(() => {
                resolve(answer)
            }).catch(console.error)
        }).bind(this)
        return new Promise((resolve, reject) => {
            this.con.createAnswer().then(answer => {
                setAnswer(answer, resolve)
            }).catch(e => {
                reject(e)
            })
        })
    }

    logEvent() {
        return function (event) {
            console.info('EVENT', event.type, event.target)
        }
    }
}