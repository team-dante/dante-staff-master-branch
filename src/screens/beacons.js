import React, {Component} from 'react';
import { StyleSheet, Text, View, ListView, DeviceEventEmitter, FlatList} from 'react-native';
import Beacons from 'react-native-beacons-manager';
import firebase from 'firebase';
import { ScrollView } from 'react-native-gesture-handler';

class FlatListItem extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <View style={{padding: 10}}>
                <Text style={{fontWeight: 'bold'}}>Room: {this.props.item.room}</Text>
                <Text>StartTime: {this.props.item.startTime}</Text>
                <Text>EndTime: {this.props.item.endTime}</Text>
                <Text>TimeElpased: {this.props.item.timeElapsed}</Text>
            </View>
        );
    }
}
export default class beacons extends Component {
    constructor(props) {
        super(props);
        // Create our dataSource which will be displayed in the ListView
        var ds = new ListView.DataSource({
            rowHasChanged: (r1, r2) => r1 !== r2 }
        );
        
        this.state = {
            bluetoothState: '',
            // region information
            identifier: 'GemTot for iOS',
            uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e',
            // React Native ListView datasource initialization
            dataSource: ds.cloneWithRows([]),
            count: 0,
            timeElapsed: 0,
            currRoom: '',
            oldRoom: '',
            timeline: [],
            major1: [],
            major2: [],
            major3: []
        };
    }

    componentWillMount() {
        // Request for authorization while the app is open
        Beacons.requestWhenInUseAuthorization();
        // Define a region which can be identifier + uuid,
        // identifier + uuid + major or identifier + uuid + major + minor
        // (minor and major properties are numbers)
        const region = {
            identifier: this.state.identifier,
            uuid: this.state.uuid
        };
        // Range for beacons inside the region
        Beacons.startRangingBeaconsInRegion(region);
        // Beacons.startUpdatingLocation();
    }

    componentDidMount() {
        // records a queue of 10 distances for each beacon
        let roomDict = {1: [], 2: [], 3:[]};
        // map beacon major to the real clinic room
        const majorToRoom = { 1: "exam1", 2: "CTRoom", 3: "femaleWaitingRoom" };
        // map beacon major to its corresponding cutoff value (1m)
        const cutoff = { 1: 1, 2: 1, 3: 1};
        // after 10 rounds, perform stats analysis
        const threshold = 7;

        // get first part before @email.com
        let user = firebase.auth().currentUser;
        let phoneNumber = user.email.split('@')[0];
        let today = this.formattedDate(new Date());
        //
        // component state aware here - attach events
        //
        // Ranging: Listen for beacon changes
        this.beaconsDidRange = DeviceEventEmitter.addListener(
            'beaconsDidRange',
            (data) => {

            // sort all beacons; from nearest distance to the furthest distance
            data.beacons.sort(function(first, second){
                return first.accuracy - second.accuracy;
            });

            let localCount = this.state.count;
            let localTimeElapsed = this.state.timeElapsed;

            if (localCount < threshold) {
                localCount++;
                localTimeElapsed++;
                this.setState({count: localCount, timeElapsed: localTimeElapsed});
                // push beacon distance; if undefined or -1, push 0
                for (let beacon of data.beacons) {

                    // ------- debugging purposes ---------
                    if (beacon["major"] == 1) {
                        this.setState({major1: roomDict[beacon["major"]]})
                    } 
                    else if (beacon["major"] == 2) {
                        this.setState({major2: roomDict[beacon["major"]]})
                    }
                    else if (beacon["major"] == 3) {
                        this.setState({major3: roomDict[beacon["major"]]})
                    } 
                     // ------ end of debugging ---------

                    // undefined or -1 will skew the distance to 999m
                    if (beacon["accuracy"] != undefined && beacon["accuracy"] != -1) {
                        roomDict[ beacon["major"] ].push(beacon["accuracy"])
                    }
                    else {
                        roomDict[ beacon["major"] ].push(999)
                    }
                }
            }
            // after 10 rounds
            else {
                let avgList = []
                for (let beacon of data.beacons) {
                    // if there are less than 10 collected distances in the array, ignore it (aka. not detected at all)
                    if (roomDict[ beacon["major"] ].length >= threshold) {
                        const total = (roomDict[ beacon["major"] ].reduce((acc, c) => acc + c, 0));
                        avgList.push([ beacon["major"], total/(threshold * 1.0)])
                    }
                    roomDict[ beacon["major"] ] = []
                }
                // avgList = [[major, avg distance], ...] (e.g. avgList = [[1, 1.0], [2, 1.4], [3, 2.0]])
                // sort by avg distance (closest beacon will come first)
                avgList.sort(function(first, second) {
                    return first[1] - second[1];
                });
                // if the avg distance of the cloest beacon is greater than the cutoff, then in "Private" mode
                // else set the current cloest clinic room
                if (avgList[0][1] != undefined && avgList[0][1] != -1) {
                    if (avgList[0][1] >= cutoff[avgList[0][0]])
                        this.setState({currRoom: 'Private'});
                    else
                        this.setState({currRoom: majorToRoom[avgList[0][0]]})
                }
                
                // ------------ time tracking starts here --------------
                var self = this;
                firebase.database().ref('/DoctorLocation/' + phoneNumber).once('value', function(snapshot) {
                    self.setState({oldRoom: snapshot.val().room});

                    let path = '/DoctorVisitByDates/' + phoneNumber + '/' + today;
                    const {currRoom, oldRoom, timeElapsed } = self.state;
                    // if the prev room is "Private" but the current one isn't, update current room's start time
                    if (oldRoom == 'Private' && currRoom != 'Private') {
                        firebase.database().ref(path).push({
                            room: currRoom, time: Date.now(), isStartTime: true
                        })
                    } // if the prev room isn't "Private" but the current one is, update end time and time spent for prev room;
                    // set the timer back to zero
                    else if (oldRoom != 'Private' && currRoom == 'Private') {
                        firebase.database().ref(path).push({
                            room: oldRoom, time: Date.now(), isStartTime: false, timeElapsed: timeElapsed
                        }).then(() => {
                            self.setState({timeElapsed: 0});
                        })
                    } // if prev and curr room are not the same and they are not "Private",
                    // 1. update end time and time spent for prev room; 2. set timer back to 0; 3. update current room's start time
                    else if (oldRoom != currRoom && (oldRoom != 'Private' && currRoom != 'Private')) {
                        firebase.database().ref(path).push({
                            room: oldRoom, time: Date.now(), isStartTime: false, timeElapsed: timeElapsed
                        }).then(() => {
                            self.setState({timeElapsed: 0});
                            // delay 1 sec so that the next start time will not be the same as prev end time
                            setTimeout(() => {console.log("timeout 1 sec")}, 1000);
                            firebase.database().ref(path).push({
                                room: currRoom, time: Date.now(), isStartTime: true
                            })
                        })
                    }
                    // ------------ time tracking ends here --------------

                    self.updateDoctorLocation(phoneNumber, self.state.currRoom);
                    self.setState({count: 0})
                });
            }
            this.setState({
                dataSource: this.state.dataSource.cloneWithRows(data.beacons)
            });
            }
        );
        var self = this;
        // always listening for changes of all time tracking data
        firebase.database().ref('/DoctorVisitByDates/' + phoneNumber + '/' + today).orderByChild('time').on('value', function(snapshot) {
            self.setState({timeline: self.parseToFlatList(snapshot.val())})
        })
    }

    parseToFlatList(jsonLst) {
        let lst = []
        for (let i in jsonLst) {
            lst.push([jsonLst[i]])
        }

        let newLst = []
        if (lst.length % 2 === 0) {
            for (let i = 0; i < lst.length-1; i++) {
                if (lst[i][0].room === lst[i+1][0].room && lst[i][0].isStartTime === true && lst[i+1][0].isStartTime === false) {
                    newLst.push([{room:lst[i][0].room, startTime: lst[i][0].time, endTime: lst[i+1][0].time, timeElapsed: lst[i+1][0].timeElapsed}])
                }
            }
        } else {
            for (let i = 0; i < lst.length-1; i++) {
                if (lst[i][0].room === lst[i+1][0].room && lst[i][0].isStartTime === true && lst[i+1][0].isStartTime === false) {
                    newLst.push([{room:lst[i][0].room, startTime: lst[i][0].time, endTime: lst[i+1][0].time, timeElapsed: lst[i+1][0].timeElapsed}])
                }
            }
            newLst.push(lst[lst.length-1])
        }

        let finalFlatLst = []
        for (let i of newLst) {
            finalFlatLst.push(i[0])
        }
        return finalFlatLst;
    }

    updateDoctorLocation(phoneNumber, roomId) {
        firebase.database().ref('/DoctorLocation/' + phoneNumber).update({
            room: roomId
        });
    }

    // return YYYY-MM-DD format
    formattedDate(now) {
        var month = now.getMonth() + 1;
        var formattedMonth = month < 10 ? '0' + month : month;
        var date = now.getDate();
        var formattedDate = date < 10 ? '0' + date : date;
        // outputs "2019-05-10"
        return now.getFullYear() + '-' + formattedMonth + '-' + formattedDate;
    }

    componentWillUnMount(){
        this.beaconsDidRange = null;
    }

    renderRow = rowData => {
        return (
        <View style={styles.row}>
            <Text style={styles.smallText}>
            UUID: {rowData.uuid ? rowData.uuid  : 'NA'}
            </Text>
            <Text style={styles.smallText}>
            Major: {rowData.major ? rowData.major : 'NA'}
            </Text>
            <Text style={styles.smallText}>
            Minor: {rowData.minor ? rowData.minor : 'NA'}
            </Text>
            <Text>
            RSSI: {rowData.rssi ? rowData.rssi : 'NA'}
            </Text>
            <Text>
            Proximity: {rowData.proximity ? rowData.proximity : 'NA'}
            </Text>
            <Text>
            Distance: {rowData.accuracy ? rowData.accuracy.toFixed(2) : 'NA'}m
            </Text>
        </View>
        );
    }

    render() {
        const { dataSource, count, currRoom, major1, major2, major3 } =  this.state;

        return (
            <ScrollView contentContainerStyle={styles.container}>
                <Text style={styles.headline}>
                All beacons in the area will be displayed
                </Text>
                <View style={{flex: 1, flexDirection: 'row'}}>
                    <View style={{width: '33.3%'}}>
                        <Text style={{fontWeight: 'bold'}}>Major 1:</Text>
                        {
                            major1.map((item, key)=>(
                                <Text key={key}> {item.toFixed(2)}m </Text>
                            ))
                        }
                    </View>
                    <View style={{width: '33.3%'}}>
                        <Text style={{fontWeight: 'bold'}}>Major 2:</Text>
                        {
                            major2.map((item, key)=>(
                                <Text key={key}> {item.toFixed(2)}m </Text>
                            ))
                        }
                    </View>
                    <View style={{width: '33.3%'}}>
                        <Text style={{fontWeight: 'bold'}}>Major 3:</Text>
                        {
                            major3.map((item, key)=>(
                                <Text key={key}> {item.toFixed(2)}m </Text>
                            ))
                        }
                    </View>
                </View>
                <Text style={{fontWeight: 'bold'}}>Count: {count} </Text> 
                <Text style={{fontWeight: 'bold', color: 'blue'}}> You are now in Room {currRoom} </Text>
                <FlatList
                    data={this.state.timeline}
                    renderItem={({item, index}) => {
                        return (
                            <FlatListItem item={item} index={index}></FlatListItem>
                        );
                    }}
                >
                </FlatList>
                <ListView
                    dataSource={ dataSource }
                    enableEmptySections={ true }
                    renderRow={this.renderRow}
                />
            </ScrollView>
        );
    }
}

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    btleConnectionStatus: {
        fontSize: 20,
        paddingTop: 20
    },
    headline: {
        fontSize: 20,
        paddingTop: 20
    },
    row: {
        padding: 8,
        paddingBottom: 16
    },
    smallText: {
        fontSize: 11
    }
});